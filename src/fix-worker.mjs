import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { recordEvent } from './automation.mjs';
import { appendControllerLog } from './controller-log.mjs';
import { appendHistory, findFixJob, findManaged, loadPrReviewStore, mutatePrReviewStore, nowIso, transitionManaged } from './pr-review-store.mjs';
import { enqueueReviewInStore } from './pr-review-queue.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import { agentCommandTimeoutMs, run } from './process.mjs';
import { loadConfig, loadRun } from './state.mjs';

function safeFixLog(root, input) {
  try { return appendControllerLog(root, { category: 'pr-reviews', source: 'automation', ...input }); }
  catch (error) {
    console.error(JSON.stringify({ subsystem: 'controller-log', error: error.message }));
    return null;
  }
}

function latestPassingValidation(state, commit) {
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary' && event.result === 'PASS' && event.commit === commit) || null;
}

function exactWorktreeHead(root, managed, runner) {
  const cwd = managed.worktreePath || root;
  const result = runner('git', ['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  if (!result?.ok) throw new Error(result?.stderr || result?.stdout || 'Could not read the PR fix worktree HEAD.');
  const head = String(result.stdout || '').trim().toLowerCase();
  if (!head) throw new Error('The PR fix worktree did not have a readable HEAD.');
  return { cwd, head };
}

function requireCleanWorktree(cwd, runner) {
  const result = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, allowFailure: true });
  if (!result?.ok) throw new Error(result?.stderr || result?.stdout || 'Could not inspect the PR fix worktree status.');
  const changes = String(result.stdout || '').trim();
  if (changes) throw new Error(`The fix Coder completed with uncommitted worktree changes:\n${changes}`);
}

function ensureControllerValidation(root, managed, runState, commit, recordValidation) {
  const existing = latestPassingValidation(runState, commit);
  if (existing) return existing;
  const saved = recordValidation(root, managed.issueNumber, {
    event: 'validation-summary',
    result: 'PASS',
    commit,
    details: 'PR fix worker recorded the exact-head validation handoff after the fix Coder completed with a clean worktree whose local HEAD matched the pushed PR head. Issue-required validation remains subject to the next independent review and GitHub CI.',
  });
  const recorded = latestPassingValidation(saved, commit);
  if (!recorded) throw new Error(`Could not record controller-owned validation for repaired PR head ${commit}.`);
  return recorded;
}

export function validateFixedHead(root, managed, job, pr, {
  config = loadConfig(root),
  runState = loadRun(root, managed.issueNumber),
  runner = run,
  recordValidation = recordEvent,
} = {}) {
  if (!pr || String(pr.state).toUpperCase() !== 'OPEN') throw new Error('The existing PR is no longer open.');
  if (pr.baseRefName && pr.baseRefName !== config.baseBranch) {
    throw new Error(`The existing PR targets ${pr.baseRefName}, not ${config.baseBranch}.`);
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    throw new Error(`The fixed PR conflicts with ${config.baseBranch}.`);
  }
  const newHeadSha = String(pr.headRefOid || '').trim().toLowerCase();
  if (!newHeadSha || newHeadSha === String(job.reviewedHeadSha || '').toLowerCase()) {
    throw new Error('The fix Coder completed without pushing a new PR head SHA.');
  }

  const worktree = exactWorktreeHead(root, managed, runner);
  if (worktree.head !== newHeadSha) {
    throw new Error(`The fix worktree HEAD ${worktree.head} does not match the repaired PR head ${newHeadSha}.`);
  }
  requireCleanWorktree(worktree.cwd, runner);
  const validation = ensureControllerValidation(root, managed, runState, newHeadSha, recordValidation);

  const fetched = runner('git', [
    'fetch', '--prune', 'origin',
    `+refs/heads/${config.baseBranch}:refs/remotes/origin/${config.baseBranch}`,
    `+refs/heads/${managed.branchName}:refs/remotes/origin/${managed.branchName}`,
  ], {
    cwd: root,
    allowFailure: true,
  });
  if (!fetched.ok) throw new Error(fetched.stderr || fetched.stdout || 'Could not refresh the fixed branch and base branch.');
  const fresh = runner('git', [
    'merge-base', '--is-ancestor',
    `refs/remotes/origin/${config.baseBranch}`,
    `refs/remotes/origin/${managed.branchName}`,
  ], { cwd: root, allowFailure: true });
  if (!fresh.ok) throw new Error(`The fixed branch does not contain the latest ${config.baseBranch}.`);
  return { newHeadSha, validation };
}

export function completeFixJob(root, fixJobId, {
  waitForAgent = true,
  snapshot = null,
  labelWriter = setPrReviewLabels,
  validator = validateFixedHead,
} = {}) {
  const initial = loadPrReviewStore(root);
  const job = findFixJob(initial, fixJobId);
  if (!job) throw new Error(`Fix job ${fixJobId} was not found.`);
  const managed = findManaged(initial, job.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${job.managedPullRequestId} was not found.`);
  safeFixLog(root, {
    action: 'run-pr-fix',
    status: 'started',
    message: `PR fix job ${job.id} started for PR #${managed.pullRequestNumber}.`,
    details: {
      fixJobId: job.id,
      managedPullRequestId: managed.id,
      pullRequestNumber: managed.pullRequestNumber,
      issueNumber: managed.issueNumber,
      reviewedHeadSha: job.reviewedHeadSha,
      coderAgentId: job.coderAgentId,
    },
  });
  if (waitForAgent) {
    const result = run('paseo', ['wait', String(job.coderAgentId)], {
      cwd: root,
      allowFailure: true,
      inherit: true,
      timeoutMs: agentCommandTimeoutMs(),
    });
    if (!result.ok) throw new Error(result.stderr || result.stdout || 'Paseo could not wait for the PR fix Coder.');
  }
  const pr = snapshot || managedPrSnapshot(root, managed.pullRequestNumber);
  const validated = validator(root, managed, job, pr);
  const newHeadSha = validated.newHeadSha;
  const result = mutatePrReviewStore(root, (store) => {
    const nextJob = findFixJob(store, fixJobId);
    const record = findManaged(store, nextJob.managedPullRequestId);
    if (!nextJob || !record || nextJob.state !== 'fixing') throw new Error('The fix job changed before completion could be recorded.');
    const at = nowIso();
    nextJob.state = 'completed';
    nextJob.completedAt = at;
    nextJob.updatedAt = at;
    nextJob.newHeadSha = newHeadSha;
    nextJob.lastError = null;
    record.currentHeadSha = newHeadSha;
    record.reviewRound += 1;
    enqueueReviewInStore(store, record, { headSha: newHeadSha, now: Date.now() });
    appendHistory(store, {
      entityType: 'fix_job', entityId: nextJob.id, previousState: 'fixing', newState: 'completed',
      reason: `Fixes pushed and validated new head ${newHeadSha}.`, actor: 'fix-worker', sha: newHeadSha, timestamp: at,
    });
    return { fixJobId: nextJob.id, newHeadSha, reviewRound: record.reviewRound };
  });
  labelWriter(root, managed.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.queued],
    remove: [PR_REVIEW_LABELS.changesRequested, PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.failed],
  });
  safeFixLog(root, {
    action: 'run-pr-fix',
    status: 'success',
    message: `PR fix job ${job.id} completed and queued a new review for PR #${managed.pullRequestNumber}.`,
    details: {
      fixJobId: job.id,
      managedPullRequestId: managed.id,
      pullRequestNumber: managed.pullRequestNumber,
      issueNumber: managed.issueNumber,
      newHeadSha,
      reviewRound: result.reviewRound,
    },
  });
  return result;
}

async function main() {
  const [root, fixJobId] = process.argv.slice(2);
  if (!root || !fixJobId) throw new Error('Usage: fix-worker.mjs <repository-root> <fix-job-id>');
  const resolvedRoot = path.resolve(root);
  try { completeFixJob(resolvedRoot, fixJobId); }
  catch (error) {
    let context = null;
    mutatePrReviewStore(resolvedRoot, (store) => {
      const job = findFixJob(store, fixJobId);
      const managed = job ? findManaged(store, job.managedPullRequestId) : null;
      context = {
        fixJobId,
        managedPullRequestId: managed?.id || job?.managedPullRequestId || null,
        pullRequestNumber: managed?.pullRequestNumber || job?.pullRequestNumber || null,
        issueNumber: managed?.issueNumber || job?.issueNumber || null,
      };
      if (job) { job.state = 'failed'; job.lastError = error.message; job.updatedAt = nowIso(); }
      if (managed) transitionManaged(store, managed, 'failed', { reason: 'PR fix job failed.', actor: 'fix-worker', error: error.message });
    });
    safeFixLog(resolvedRoot, {
      level: 'error',
      action: 'run-pr-fix',
      status: 'failed',
      message: `PR fix job ${fixJobId} failed: ${error.message}`,
      details: { ...context, error },
    });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
