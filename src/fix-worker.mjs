import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendHistory, findFixJob, findManaged, loadPrReviewStore, mutatePrReviewStore, nowIso, transitionManaged } from './pr-review-store.mjs';
import { enqueueReviewInStore } from './pr-review-queue.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import { run } from './process.mjs';
import { loadConfig, loadRun } from './state.mjs';

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
  if (waitForAgent) {
    const result = run('paseo', ['wait', String(job.coderAgentId)], { cwd: root, allowFailure: true, inherit: true });
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
  return result;
}

async function main() {
  const [root, fixJobId] = process.argv.slice(2);
  if (!root || !fixJobId) throw new Error('Usage: fix-worker.mjs <repository-root> <fix-job-id>');
  try { completeFixJob(path.resolve(root), fixJobId); }
  catch (error) {
    mutatePrReviewStore(path.resolve(root), (store) => {
      const job = findFixJob(store, fixJobId);
      const managed = job ? findManaged(store, job.managedPullRequestId) : null;
      if (job) { job.state = 'failed'; job.lastError = error.message; job.updatedAt = nowIso(); }
      if (managed) transitionManaged(store, managed, 'failed', { reason: 'PR fix job failed.', actor: 'fix-worker', error: error.message });
    });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
