import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

export function validateFixedHead(root, managed, job, pr, {
  config = loadConfig(root),
  runState = loadRun(root, managed.issueNumber),
  runner = run,
} = {}) {
  if (!pr || String(pr.state).toUpperCase() !== 'OPEN') throw new Error('The existing PR is no longer open.');
  if (pr.baseRefName && pr.baseRefName !== config.baseBranch) {
    throw new Error(`The existing PR targets ${pr.baseRefName}, not ${config.baseBranch}.`);
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    throw new Error(`The fixed PR conflicts with ${config.baseBranch}.`);
  }
  const newHeadSha = String(pr.headRefOid || '').toLowerCase();
  if (!newHeadSha || newHeadSha === job.reviewedHeadSha) {
    throw new Error('The fix Coder completed without pushing a new PR head SHA.');
  }
  const validation = latestPassingValidation(runState, newHeadSha);
  if (!validation) {
    throw new Error(`The fix Coder did not record passing validation for the new PR head ${newHeadSha}.`);
  }
  const fetched = runner('git', ['fetch', '--prune', 'origin', config.baseBranch, managed.branchName], {
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
