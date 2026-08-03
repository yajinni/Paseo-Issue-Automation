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
import { evaluateApprovedReviewGate, finalizeApprovedBrowserReview } from './pr-review-finalize.mjs';
import {
  closeAssociatedIssue,
  issueSnapshot,
  managedPrSnapshot,
  prHasExplicitIssueAssociation,
  PR_REVIEW_LABELS,
  setPrReviewLabels,
} from './pr-review-github.mjs';
import { matchingReviewResult } from './review-result.mjs';

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

function terminateManagedJobs(store, managed, reason, at) {
  for (const job of store.reviewJobs.filter((candidate) => candidate.managedPullRequestId === managed.id
    && !['completed', 'superseded', 'cancelled'].includes(candidate.state))) {
    const previous = job.state;
    job.state = 'cancelled';
    job.completedAt = at;
    job.updatedAt = at;
    job.lastError = reason;
    appendHistory(store, {
      entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'cancelled',
      reason, actor: 'reconciliation', sha: job.headSha, timestamp: at,
    });
    if (store.runtime.activeReviewJobId === job.id) store.runtime.activeReviewJobId = null;
  }
  for (const job of store.fixJobs.filter((candidate) => candidate.managedPullRequestId === managed.id
    && !['completed', 'cancelled'].includes(candidate.state))) {
    const previous = job.state;
    job.state = 'cancelled';
    job.completedAt = at;
    job.updatedAt = at;
    job.lastError = reason;
    appendHistory(store, {
      entityType: 'fix_job', entityId: job.id, previousState: previous, newState: 'cancelled',
      reason, actor: 'reconciliation', sha: job.reviewedHeadSha, timestamp: at,
    });
  }
  managed.activeReviewRequestId = null;
  managed.queuePosition = null;
}

function reconcileMergedInStore(store, managed, pr, at) {
  transitionManaged(store, managed, 'merged', {
    reason: `PR #${managed.pullRequestNumber} merged.`,
    actor: 'reconciliation',
    sha: pr.headRefOid || managed.currentHeadSha,
    at,
  });
  terminateManagedJobs(store, managed, 'The pull request reached the terminal merged state.', at);
  managed.issueClosurePending = store.config.githubActions.verifyIssueClosure;
  managed.lastError = null;
  return {
    state: 'merged',
    effects: [
      { type: 'clear-review-labels', pullRequestNumber: managed.pullRequestNumber },
      {
        type: 'verify-merged-issue',
        managedId: managed.id,
        issueNumber: managed.issueNumber,
        pullRequestNumber: managed.pullRequestNumber,
        verifyIssueClosure: store.config.githubActions.verifyIssueClosure,
        allowClosureFallback: store.config.githubActions.allowPaseoIssueClosureFallback,
        explicitAssociation: prHasExplicitIssueAssociation(pr, managed.issueNumber),
      },
    ],
  };
}

function reconcileClosedUnmergedInStore(store, managed, at) {
  transitionManaged(store, managed, 'closed_unmerged', {
    reason: 'PR was closed without merge. Associated issue remains open.', actor: 'reconciliation', at,
  });
  terminateManagedJobs(store, managed, 'The pull request was closed without merge.', at);
  managed.lastError = 'Closed without merge. Operator action is required.';
  return {
    state: 'closed_unmerged',
    needsOperator: true,
    effects: [{ type: 'clear-review-labels', pullRequestNumber: managed.pullRequestNumber }],
  };
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
    entityType: 'managed_pull_request', entityId: managed.id,
    reason: `PR head changed from ${previousSha} to ${newSha}; newest SHA queued after debounce.`,
    actor: 'reconciliation', sha: newSha, timestamp: at,
  });
  return job;
}

function reviewResultForSnapshot(store, managed, pr) {
  const reviewJob = activeReviewForManaged(store, managed);
  if (!reviewJob || reviewJob.state !== 'awaiting_result') return { reviewJob: null, result: null };
  const result = matchingReviewResult({ comments: pr.comments || [], reviews: pr.reviews || [] }, {
    reviewRequestId: reviewJob.reviewRequestId,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    headSha: reviewJob.headSha,
    promptVersion: reviewJob.promptVersion,
  });
  return { reviewJob, result };
}

function changesRequestedLabelEffect(managed) {
  return {
    type: 'set-review-labels',
    pullRequestNumber: managed.pullRequestNumber,
    add: [PR_REVIEW_LABELS.changesRequested],
    remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed],
  };
}

function reconcileReviewResultInStore(store, managed, pr, at, precomputed = {}) {
  const reviewJob = activeReviewForManaged(store, managed);
  if (!reviewJob || reviewJob.state !== 'awaiting_result') return null;
  const reservationMatches = !precomputed.reviewJob || precomputed.reviewJob.id === reviewJob.id;
  const result = reservationMatches ? precomputed.result : null;
  const resolvedResult = result || matchingReviewResult({ comments: pr.comments || [], reviews: pr.reviews || [] }, {
    reviewRequestId: reviewJob.reviewRequestId,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    headSha: reviewJob.headSha,
    promptVersion: reviewJob.promptVersion,
  });
  if (!resolvedResult || managed.lastProcessedReviewRequestId === resolvedResult.reviewRequestId) return null;
  if (managed.currentHeadSha !== resolvedResult.headSha || resolvedResult.result === 'stale') {
    completeReviewJob(store, reviewJob, 'stale', resolvedResult.sourceId, at);
    enqueueReviewInStore(store, managed, { headSha: managed.currentHeadSha, now: Date.parse(at) });
    return { result: 'stale', requeued: true, effects: [] };
  }
  if (resolvedResult.result === 'changes_requested') {
    if (!labelNames(pr).has(PR_REVIEW_LABELS.changesRequested)) return null;
    const fixJob = createFixJobInStore(store, managed, reviewJob, resolvedResult.humanMarkdown, {
      sourceCommentId: resolvedResult.sourceId, now: Date.parse(at),
    });
    return {
      result: 'changes_requested',
      fixJobId: fixJob.id,
      effects: [changesRequestedLabelEffect(managed)],
    };
  }

  const gate = reservationMatches ? precomputed.gate : null;
  if (!gate?.ok) {
    managed.lastError = gate?.reason || 'The deterministic approval gate must be reevaluated on the current reservation.';
    if (gate?.stale) {
      completeReviewJob(store, reviewJob, 'stale', resolvedResult.sourceId, at);
      enqueueReviewInStore(store, managed, { headSha: managed.currentHeadSha, now: Date.parse(at) });
      return { result: 'stale', requeued: true, effects: [] };
    }
    if (gate?.repair) {
      const fixJob = createFixJobInStore(store, managed, reviewJob, gate.reason, {
        sourceCommentId: resolvedResult.sourceId, now: Date.parse(at),
      });
      return {
        result: 'approved-gate-failed',
        fixJobId: fixJob.id,
        reason: gate.reason,
        effects: [changesRequestedLabelEffect(managed)],
      };
    }
    return { result: 'approved-waiting-gate', waiting: true, reason: managed.lastError, effects: [] };
  }

  completeReviewJob(store, reviewJob, 'approved', resolvedResult.sourceId, at);
  managed.lastCompletedReviewSha = reviewJob.headSha;
  managed.lastReviewCommentId = resolvedResult.sourceId;
  managed.lastProcessedReviewRequestId = reviewJob.reviewRequestId;
  managed.lastError = null;
  transitionManaged(store, managed, 'ready_to_merge', {
    reason: store.config.githubActions.allowChatGPTMerge
      ? 'Review approval passed deterministic CI, base, conflict, and exact-SHA gates.'
      : 'Review approval passed all deterministic gates and the issue entered human review.',
    actor: 'reconciliation', sha: reviewJob.headSha, at,
  });
  return {
    result: 'approved',
    readyToMerge: true,
    effects: [{ type: 'clear-review-labels', pullRequestNumber: managed.pullRequestNumber }],
  };
}

function recordExternalEffectFailure(root, managedId, error) {
  mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) return;
    managed.lastError = String(error?.message || error);
    managed.updatedAt = nowIso();
    appendHistory(store, {
      entityType: 'managed_pull_request', entityId: managed.id,
      reason: 'A post-reconciliation GitHub effect failed.', actor: 'reconciliation',
      sha: managed.currentHeadSha, error: managed.lastError,
    });
  });
}

function updateMergedIssueStatus(root, effect, patch) {
  mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, effect.managedId);
    if (!managed || managed.reviewState !== 'merged') return;
    Object.assign(managed, patch, { updatedAt: nowIso() });
  });
}

function applyMergedIssueEffect(root, effect) {
  if (!effect.verifyIssueClosure) {
    updateMergedIssueStatus(root, effect, { issueClosurePending: false, lastError: null });
    return { issueClosed: true, verificationSkipped: true };
  }
  const issue = issueSnapshot(root, effect.issueNumber);
  if (!issue) throw new Error(`Could not verify associated issue #${effect.issueNumber} after merge.`);
  if (String(issue.state).toUpperCase() === 'CLOSED') {
    updateMergedIssueStatus(root, effect, { issueClosurePending: false, lastError: null });
    return { issueClosed: true };
  }
  if (!effect.allowClosureFallback) {
    const message = `PR merged, but associated issue #${effect.issueNumber} remains open.`;
    updateMergedIssueStatus(root, effect, { issueClosurePending: true, lastError: message });
    return { issueClosed: false, needsOperator: true };
  }
  if (!effect.explicitAssociation) {
    const message = `PR merged, but issue association for #${effect.issueNumber} is ambiguous.`;
    updateMergedIssueStatus(root, effect, { issueClosurePending: true, lastError: message });
    return { issueClosed: false, needsOperator: true };
  }
  closeAssociatedIssue(root, effect.issueNumber, effect.pullRequestNumber);
  updateMergedIssueStatus(root, effect, { issueClosurePending: false, lastError: null });
  return { issueClosed: true, closedByPaseo: true };
}

export function applyReconciliationEffects(root, managedId, effects = []) {
  const results = [];
  for (const effect of effects) {
    try {
      if (effect.type === 'set-review-labels') {
        results.push(setPrReviewLabels(root, effect.pullRequestNumber, {
          add: effect.add || [],
          remove: effect.remove || [],
        }));
      } else if (effect.type === 'clear-review-labels') {
        results.push(setPrReviewLabels(root, effect.pullRequestNumber, {
          remove: Object.values(PR_REVIEW_LABELS),
        }));
      } else if (effect.type === 'verify-merged-issue') {
        results.push(applyMergedIssueEffect(root, effect));
      }
    } catch (error) {
      recordExternalEffectFailure(root, managedId, error);
      throw error;
    }
  }
  return results;
}

export function reconcileManagedPullRequest(root, managedId, {
  now = Date.now(),
  snapshot = null,
  effectRunner = applyReconciliationEffects,
} = {}) {
  const at = nowIso(now);
  const current = loadPrReviewStore(root);
  const currentManaged = findManaged(current, managedId);
  if (!currentManaged) throw new Error(`Managed PR ${managedId} was not found.`);
  if (currentManaged.reviewState === 'paused') return { state: 'paused', skipped: true };
  const pr = snapshot || managedPrSnapshot(root, currentManaged.pullRequestNumber);
  if (!pr) throw new Error(`Could not reconcile PR #${currentManaged.pullRequestNumber}.`);

  const precomputed = reviewResultForSnapshot(current, currentManaged, pr);
  if (precomputed.result?.result === 'approved' && precomputed.reviewJob
      && currentManaged.currentHeadSha === precomputed.result.headSha) {
    precomputed.gate = evaluateApprovedReviewGate(root, currentManaged, precomputed.reviewJob, pr);
    if (precomputed.gate.ok && !current.config.githubActions.allowChatGPTMerge) {
      finalizeApprovedBrowserReview(root, currentManaged, precomputed.reviewJob, {
        findings: precomputed.result.humanMarkdown || 'Browser Reviewer approved this exact validated commit.',
        pr,
        gate: precomputed.gate,
      });
    }
  }

  const outcome = mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} disappeared during reconciliation.`);
    managed.lastReconciledAt = at;
    if (pr.mergedAt || String(pr.state).toUpperCase() === 'MERGED') {
      return reconcileMergedInStore(store, managed, pr, at);
    }
    if (String(pr.state).toUpperCase() === 'CLOSED') {
      return reconcileClosedUnmergedInStore(store, managed, at);
    }
    const headJob = reconcileHeadChange(store, managed, pr, at);
    const review = reconcileReviewResultInStore(store, managed, pr, at, precomputed);
    return {
      state: managed.reviewState,
      headChanged: Boolean(headJob),
      review,
      effects: review?.effects || [],
    };
  });
  const effectResults = effectRunner(root, managedId, outcome.effects || []);
  return { ...outcome, effects: effectResults };
}

export function reconcileManagedPullRequests(root, options = {}) {
  const store = loadPrReviewStore(root);
  const records = store.managedPullRequests.filter((managed) => managed.reviewState !== 'paused' && !TERMINAL_PR_STATES.has(managed.reviewState));
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

export function recoverPrReviewState(root, { now = Date.now(), effectRunner = applyReconciliationEffects } = {}) {
  mutatePrReviewStore(root, (store) => {
    const at = nowIso(now);
    store.runtime.activeReviewJobId = null;
    for (const job of store.reviewJobs) {
      const managed = findManaged(store, job.managedPullRequestId);
      if (job.state === 'submitting') {
        if (!managed || managed.reviewState === 'paused' || TERMINAL_PR_STATES.has(managed.reviewState)) {
          job.state = 'cancelled';
          job.completedAt = at;
        } else {
          job.state = 'queued';
          job.dueAt = at;
        }
        job.updatedAt = at;
        appendHistory(store, {
          entityType: 'review_job', entityId: job.id, previousState: 'submitting', newState: job.state,
          reason: job.state === 'queued' ? 'Recovered interrupted browser submission.' : 'Cancelled interrupted submission for inactive PR.',
          actor: 'startup-recovery', sha: job.headSha, timestamp: at,
        });
      }
    }
    for (const job of store.fixJobs) {
      const managed = findManaged(store, job.managedPullRequestId);
      if (job.state === 'fixing') {
        job.state = !managed || managed.reviewState === 'paused' || TERMINAL_PR_STATES.has(managed.reviewState) ? 'cancelled' : 'interrupted';
        job.updatedAt = at;
        job.lastError = job.state === 'interrupted' ? 'Fix worker was interrupted before recovery.' : 'Fix job cancelled because its PR is inactive.';
        appendHistory(store, {
          entityType: 'fix_job', entityId: job.id, previousState: 'fixing', newState: job.state,
          reason: job.lastError, actor: 'startup-recovery', sha: job.reviewedHeadSha, timestamp: at,
        });
      }
    }
  });
  return reconcileManagedPullRequests(root, { now, effectRunner });
}
