import { appendHistory, clone, findManaged, mutatePrReviewStore, nowIso, transitionManaged } from './pr-review-store.mjs';
import { enqueueReviewInStore } from './pr-review-queue.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { run } from './process.mjs';

function managedRecord(root, id) {
  let result;
  mutatePrReviewStore(root, (store) => { result = clone(findManaged(store, id)); });
  if (!result) throw new Error(`Managed PR ${id} was not found.`);
  return result;
}

export function reopenClosedPullRequest(root, managedId) {
  const managed = managedRecord(root, managedId);
  const result = run('gh', ['pr', 'reopen', String(managed.pullRequestNumber)], { cwd: root, allowFailure: true });
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Could not reopen the PR.');
  const pr = managedPrSnapshot(root, managed.pullRequestNumber);
  if (!pr || String(pr.state).toUpperCase() !== 'OPEN') throw new Error('GitHub did not confirm that the PR reopened.');
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managedId);
    record.currentHeadSha = String(pr.headRefOid || record.currentHeadSha).toLowerCase();
    record.reviewRound += 1;
    const job = enqueueReviewInStore(store, record, { headSha: record.currentHeadSha, immediate: true });
    appendHistory(store, { entityType: 'managed_pull_request', entityId: record.id, reason: 'Closed PR reopened and returned to review queue.', actor: 'user', sha: record.currentHeadSha });
    return { managed: clone(record), reviewJob: clone(job) };
  });
}

export function returnIssueToCodingQueue(root, managedId) {
  const managed = managedRecord(root, managedId);
  run('gh', ['issue', 'edit', String(managed.issueNumber), '--add-label', PASEO_LABELS.ready, '--remove-label', PASEO_LABELS.coding, '--remove-label', PASEO_LABELS.reviewQueued], { cwd: root });
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managedId);
    transitionManaged(store, record, 'paused', { reason: 'Associated issue returned to the normal coding queue.', actor: 'user' });
    return clone(record);
  });
}

export function returnIssueToBacklog(root, managedId) {
  const managed = managedRecord(root, managedId);
  run('gh', ['issue', 'edit', String(managed.issueNumber), '--remove-label', PASEO_LABELS.ready, '--remove-label', PASEO_LABELS.coding, '--remove-label', PASEO_LABELS.reviewQueued], { cwd: root, allowFailure: true });
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managedId);
    transitionManaged(store, record, 'paused', { reason: 'Associated issue returned to backlog.', actor: 'user' });
    return clone(record);
  });
}

export function cancelAssociatedIssue(root, managedId) {
  const managed = managedRecord(root, managedId);
  const result = run('gh', ['issue', 'close', String(managed.issueNumber), '--reason', 'not planned', '--comment', `Cancelled after PR #${managed.pullRequestNumber} was closed without merge.`], { cwd: root, allowFailure: true });
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Could not cancel the associated issue.');
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managedId);
    transitionManaged(store, record, 'paused', { reason: 'Associated issue cancelled by operator.', actor: 'user' });
    return clone(record);
  });
}

export function markManagedPrManuallyResolved(root, managedId, note = 'Marked manually resolved by operator.') {
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managedId);
    if (!record) throw new Error(`Managed PR ${managedId} was not found.`);
    transitionManaged(store, record, 'paused', { reason: note, actor: 'user' });
    record.lastError = null;
    appendHistory(store, { entityType: 'managed_pull_request', entityId: record.id, reason: note, actor: 'user', sha: record.currentHeadSha, timestamp: nowIso() });
    return clone(record);
  });
}

export function clearPrReviewLabels(root, managedId) {
  const managed = managedRecord(root, managedId);
  return setPrReviewLabels(root, managed.pullRequestNumber, {
    remove: Object.values(PR_REVIEW_LABELS),
  });
}
