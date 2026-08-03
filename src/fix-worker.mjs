import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendHistory, findFixJob, findManaged, loadPrReviewStore, mutatePrReviewStore, nowIso, transitionManaged } from './pr-review-store.mjs';
import { enqueueReviewInStore } from './pr-review-queue.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import { run } from './process.mjs';

export function completeFixJob(root, fixJobId, { waitForAgent = true, snapshot = null, labelWriter = setPrReviewLabels } = {}) {
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
  if (!pr || String(pr.state).toUpperCase() !== 'OPEN') throw new Error('The existing PR is no longer open.');
  const newHeadSha = String(pr.headRefOid || '').toLowerCase();
  if (!newHeadSha || newHeadSha === job.reviewedHeadSha) throw new Error('The fix Coder completed without pushing a new PR head SHA.');
  const result = mutatePrReviewStore(root, (store) => {
    const nextJob = findFixJob(store, fixJobId);
    const record = findManaged(store, nextJob.managedPullRequestId);
    const at = nowIso();
    nextJob.state = 'completed';
    nextJob.completedAt = at;
    nextJob.updatedAt = at;
    nextJob.newHeadSha = newHeadSha;
    nextJob.lastError = null;
    record.currentHeadSha = newHeadSha;
    record.reviewRound += 1;
    enqueueReviewInStore(store, record, { headSha: newHeadSha, now: Date.now() });
    appendHistory(store, { entityType: 'fix_job', entityId: nextJob.id, previousState: 'fixing', newState: 'completed', reason: `Fixes pushed new head ${newHeadSha}.`, actor: 'fix-worker', sha: newHeadSha, timestamp: at });
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
