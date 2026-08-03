import {
  appendHistory,
  findManaged,
  loadPrReviewStore,
  mutatePrReviewStore,
  nowIso,
  recordReconciliation,
  TERMINAL_PR_STATES,
  transitionManaged,
} from './pr-review-store.mjs';
import { createFixJobInStore, enqueueReviewInStore } from './pr-review-queue.mjs';
import {
  closeAssociatedIssue,
  issueSnapshot,
  managedPrSnapshot,
  prHasExplicitIssueAssociation,
  PR_REVIEW_LABELS,
  setPrReviewLabels,
} from './pr-review-github.mjs';
import { matchingReviewResult } from './review-result.mjs';
import { markHumanReview } from './automation.mjs';

function labelNames(pr) {
  return new Set((pr?.labels || []).map((label) => typeof label === 'string' ? label : label.name));
}

function activeReviewForManaged(store, managed) {
  if (managed.activeReviewRequestId) {
    const exact = store.reviewJobs.find((job) => job.reviewRequestId === managed.activeReviewRequestId);
    if (exact) return exact;
  }
  return store.reviewJobs
    .filter((job) => job.managedPullRequestId === managed.id && ['submitting', 'awaiting_result'].includes(job.state))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

function completeReviewJob(store, job, result, sourceId, at) {
  const previous = job.state;
  job.state = 'completed';
  job.completedAt = at;
  job.updatedAt = at;
  job.result = result;
  job.resultSourceId = sourceId || null;
  appendHistory(store, {
    entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'completed',
    reason: `Processed ${result} review result.`, actor: 'reconciliation', sha: job.headSha, timestamp: at,
  });
}

function reconcileMerged(root, store, managed, pr, at) {
  transitionManaged(store, managed, 'merged', { reason: `PR #${managed.pullRequestNumber} merged.`, actor: 'reconciliation', sha: pr.headRefOid || managed.currentHeadSha, at });
  managed.issueClosurePending = false;
  for (const job of store.reviewJobs.filter((candidate) => candidate.managedPullRequestId === managed.id && !['completed', 'superseded', 'cancelled'].includes(candidate.state))) {
    completeReviewJob(store, job, 'merged', null, at);
  }
  const issue = issueSnapshot(root, managed.issueNumber);
  if (!store.config.githubActions.verifyIssueClosure || String(issue?.state).toUpperCase() === 'CLOSED') return { state: 'merged', issueClosed: true };
  managed.issueClosurePending = true;
  if (!store.config.githubActions.allowPaseoIssueClosureFallback) {
    managed.lastError = `PR merged, but associated issue #${managed.issueNumber} remains open.`;
    return { state: 'merged', issueClosed: false, needsOperator: true };
  }
  if (!prHasExplicitIssueAssociation(pr, managed.issueNumber)) {
    managed.lastError = `PR merged, but issue association for #${managed.issueNumber} is ambiguous.`;
    return { state: 'merged', issueClosed: false, needsOperator: true };
  }
  closeAssociatedIssue(root, managed.issueNumber, managed.pullRequestNumber);
  managed.issueClosurePending = false;
  managed.lastError = null;
  return { state: 'merged', issueClosed: true, closedByPaseo: true };
}

function reconcileClosedUnmerged(store, managed, at) {
  transitionManaged(store, managed, 'closed_unmerged', {
    reason: 'PR was closed without merge. Associated issue remains open.', actor: 'reconciliation', at,
  });
  managed.lastError = 'Closed without merge. Operator action is required.';
  return { state: 'closed_unmerged', needsOperator: true };
}

function reconcileHeadChange(store, managed, pr, at) {
  const newSha = String(pr.headRefOid || '').toLowerCase();
  if (!newSha || newSha === managed.currentHeadSha) return null;
  const previousSha = managed.currentHeadSha;
  managed.currentHeadSha = newSha;
  managed.updatedAt = at;
  managed.lastActivityAt = at;
  managed.reviewRound += 1;
  const job = enqueueReviewInStore(store, managed, { headSha: newSha, now: Date.parse(at) });
  appendHistory(store, {
    entityType: 'managed_pull_request', entityId: managed.id, reason: `PR head changed from ${previousSha} to ${newSha}; newest SHA queued after debounce.`,
    actor: 'reconciliation', sha: newSha, timestamp: at,
  });
  return job;
}

function reconcileReviewResult(root, store, managed, pr, at) {
  const reviewJob = activeReviewForManaged(store, managed);
  if (!reviewJob || reviewJob.state !== 'awaiting_result') return null;
  const result = matchingReviewResult({ comments: pr.comments || [], reviews: pr.reviews || [] }, {
    reviewRequestId: reviewJob.reviewRequestId,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    headSha: reviewJob.headSha,
    promptVersion: reviewJob.promptVersion,
  });
  if (!result || managed.lastProcessedReviewRequestId === result.reviewRequestId) return null;
  if (managed.currentHeadSha !== result.headSha || result.result === 'stale') {
    completeReviewJob(store, reviewJob, 'stale', result.sourceId, at);
    enqueueReviewInStore(store, managed, { headSha: managed.currentHeadSha, now: Date.parse(at) });
    return { result: 'stale', requeued: true };
  }
  if (result.result === 'changes_requested') {
    const labels = labelNames(pr);
    if (!labels.has(PR_REVIEW_LABELS.changesRequested)) return null;
    const fixJob = createFixJobInStore(store, managed, reviewJob, result.humanMarkdown, {
      sourceCommentId: result.sourceId, now: Date.parse(at),
    });
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.changesRequested],
      remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed],
    });
    return { result: 'changes_requested', fixJobId: fixJob.id };
  }
  completeReviewJob(store, reviewJob, 'approved', result.sourceId, at);
  managed.lastCompletedReviewSha = reviewJob.headSha;
  managed.lastReviewCommentId = result.sourceId;
  managed.lastProcessedReviewRequestId = reviewJob.reviewRequestId;
  transitionManaged(store, managed, 'ready_to_merge', {
    reason: store.config.githubActions.allowChatGPTMerge
      ? 'Review approved; waiting for ChatGPT merge reconciliation.'
      : 'Review approved; automatic merge is disabled.',
    actor: 'reconciliation', sha: reviewJob.headSha, at,
  });
  setPrReviewLabels(root, managed.pullRequestNumber, {
    remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.changesRequested, PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.failed],
  });
  if (!store.config.githubActions.allowChatGPTMerge) {
    try { markHumanReview(root, managed.issueNumber, managed.pullRequestNumber); } catch (error) { managed.lastError = error.message; }
  }
  return { result: 'approved', readyToMerge: true };
}

export function reconcileManagedPullRequest(root, managedId, { now = Date.now(), snapshot = null } = {}) {
  const at = nowIso(now);
  const current = loadPrReviewStore(root);
  const currentManaged = findManaged(current, managedId);
  if (!currentManaged) throw new Error(`Managed PR ${managedId} was not found.`);
  const pr = snapshot || managedPrSnapshot(root, currentManaged.pullRequestNumber);
  if (!pr) throw new Error(`Could not reconcile PR #${currentManaged.pullRequestNumber}.`);
  let outcome;
  mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    managed.lastReconciledAt = at;
    if (pr.mergedAt || String(pr.state).toUpperCase() === 'MERGED') {
      outcome = reconcileMerged(root, store, managed, pr, at);
      return;
    }
    if (String(pr.state).toUpperCase() === 'CLOSED') {
      outcome = reconcileClosedUnmerged(store, managed, at);
      return;
    }
    const headJob = reconcileHeadChange(store, managed, pr, at);
    const review = reconcileReviewResult(root, store, managed, pr, at);
    outcome = { state: managed.reviewState, headChanged: Boolean(headJob), review };
  });
  return outcome;
}

export function reconcileManagedPullRequests(root, options = {}) {
  const store = loadPrReviewStore(root);
  const records = store.managedPullRequests.filter((managed) => !TERMINAL_PR_STATES.has(managed.reviewState));
  const result = { checked: 0, changed: 0, errors: [] };
  for (const managed of records) {
    try {
      const outcome = reconcileManagedPullRequest(root, managed.id, options);
      result.checked += 1;
      if (outcome?.headChanged || outcome?.review || outcome?.state === 'merged' || outcome?.state === 'closed_unmerged') result.changed += 1;
    } catch (error) {
      result.checked += 1;
      result.errors.push({ managedPullRequestId: managed.id, error: error.message });
      mutatePrReviewStore(root, (next) => {
        const record = findManaged(next, managed.id);
        if (record) { record.lastError = error.message; record.lastReconciledAt = nowIso(options.now || Date.now()); }
      });
    }
  }
  recordReconciliation(root, result, options);
  return result;
}

export function recoverPrReviewState(root, { now = Date.now() } = {}) {
  mutatePrReviewStore(root, (store) => {
    const at = nowIso(now);
    store.runtime.activeReviewJobId = null;
    for (const job of store.reviewJobs) {
      if (job.state === 'submitting') {
        job.state = 'queued'; job.dueAt = at; job.updatedAt = at;
        appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: 'submitting', newState: 'queued', reason: 'Recovered interrupted browser submission.', actor: 'startup-recovery', sha: job.headSha, timestamp: at });
      }
    }
    for (const job of store.fixJobs) {
      if (job.state === 'fixing') {
        job.state = 'interrupted'; job.updatedAt = at; job.lastError = 'Fix worker was interrupted before recovery.';
        appendHistory(store, { entityType: 'fix_job', entityId: job.id, previousState: 'fixing', newState: 'interrupted', reason: 'Recovered interrupted fix worker.', actor: 'startup-recovery', sha: job.reviewedHeadSha, timestamp: at });
      }
    }
  });
  return reconcileManagedPullRequests(root, { now });
}
