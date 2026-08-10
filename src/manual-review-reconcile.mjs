import { markHumanReview, recordEvent } from './automation.mjs';
import { createFixJobInStore } from './pr-review-queue.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import {
  appendHistory,
  clone,
  findManaged,
  loadPrReviewStore,
  managedPullRequestId,
  mutatePrReviewStore,
  nowIso,
  transitionManaged,
} from './pr-review-store.mjs';
import { evaluateManualReviewSnapshot, enterManualReview } from './manual-review-lifecycle.mjs';
import { run } from './process.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { loadRun, saveRun } from './state.mjs';

const MANUAL_REQUEST_PREFIX = 'manual-review:';

function manualRequestId(managedId, headSha) {
  return `${MANUAL_REQUEST_PREFIX}${managedId}:${String(headSha || '').toLowerCase()}`;
}

export function isManualReviewRequest(value) {
  return String(value || '').startsWith(MANUAL_REQUEST_PREFIX);
}

function manualRun(root, managed) {
  const state = loadRun(root, managed.issueNumber);
  return state?.reviewRuntimeStage === 'full-manual' ? state : null;
}

function latestValidation(state, headSha) {
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary'
      && event.result === 'PASS'
      && String(event.commit || '').toLowerCase() === String(headSha || '').toLowerCase()) || null;
}

function updateManualRun(root, issueNumber, patch, activity = null) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const at = nowIso();
  return saveRun(root, issueNumber, {
    ...state,
    ...patch,
    updatedAt: at,
    heartbeatAt: at,
    activity: activity
      ? [...(state.activity || []), { type: activity.type, at, details: activity.details || '' }]
      : state.activity || [],
  });
}

export function registerManualReviewPullRequest(root, input, { now = Date.now() } = {}) {
  return mutatePrReviewStore(root, (store) => {
    const id = managedPullRequestId(input.repository, input.pullRequestNumber);
    const at = nowIso(now);
    const headSha = String(input.currentHeadSha || '').trim().toLowerCase();
    if (!/^[0-9a-f]{7,64}$/.test(headSha)) throw new Error('Manual review registration requires a valid exact PR head SHA.');
    let managed = findManaged(store, id);
    if (!managed) {
      managed = {
        id,
        repository: String(input.repository),
        issueNumber: Number(input.issueNumber),
        issueUrl: input.issueUrl || null,
        pullRequestNumber: Number(input.pullRequestNumber),
        pullRequestUrl: String(input.pullRequestUrl),
        branchName: String(input.branchName),
        worktreePath: input.worktreePath || null,
        workspaceId: input.workspaceId || null,
        coderAgentId: input.coderAgentId || null,
        currentHeadSha: headSha,
        lastSubmittedReviewSha: null,
        lastCompletedReviewSha: null,
        reviewRound: Math.max(1, Number(input.reviewRound) || 1),
        reviewPromptVersion: store.config.browserReview.reviewPromptVersion,
        reviewState: 'paused',
        queuePosition: null,
        priority: Number(input.priority) || 0,
        activeReviewRequestId: manualRequestId(id, headSha),
        lastReviewCommentId: null,
        lastProcessedReviewRequestId: null,
        conversationUrlOverride: null,
        createdAt: at,
        updatedAt: at,
        lastReconciledAt: null,
        lastActivityAt: at,
        lastError: null,
        issueClosurePending: false,
        lifecycleCompletionPending: false,
        reviewEvidenceMissing: false,
        diagnosticScreenshot: null,
      };
      store.managedPullRequests.push(managed);
      appendHistory(store, {
        entityType: 'managed_pull_request',
        entityId: managed.id,
        previousState: null,
        newState: 'paused',
        reason: `PR #${managed.pullRequestNumber} entered exact-head manual review.`,
        actor: 'controller',
        sha: headSha,
        timestamp: at,
      });
    } else {
      managed.issueNumber = Number(input.issueNumber);
      managed.issueUrl = input.issueUrl || managed.issueUrl;
      managed.pullRequestUrl = String(input.pullRequestUrl || managed.pullRequestUrl);
      managed.branchName = String(input.branchName || managed.branchName);
      managed.worktreePath = input.worktreePath || managed.worktreePath;
      managed.workspaceId = input.workspaceId || managed.workspaceId;
      managed.coderAgentId = input.coderAgentId || managed.coderAgentId;
      managed.currentHeadSha = headSha;
      managed.reviewState = 'paused';
      managed.activeReviewRequestId = manualRequestId(id, headSha);
      managed.queuePosition = null;
      managed.lastError = null;
      managed.updatedAt = at;
      managed.lastActivityAt = at;
    }
    return clone(managed);
  });
}

function manualFindings(review) {
  return String(review?.body || '').trim();
}

function queueManualFix(root, managedId, review, expectedHeadSha, { now = Date.now() } = {}) {
  const findings = manualFindings(review);
  if (!findings) {
    const error = new Error('Manual review requested changes without a review body. Paseo cannot create an authoritative repair handoff without the requested changes.');
    error.code = 'MANUAL_REVIEW_FINDINGS_MISSING';
    throw error;
  }
  const result = mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
    const requestId = manualRequestId(managed.id, expectedHeadSha);
    const syntheticReview = {
      id: requestId,
      reviewRequestId: requestId,
      reviewRound: managed.reviewRound,
      headSha: expectedHeadSha,
      state: 'awaiting_result',
      result: 'changes_requested',
      resultSourceId: review?.id ?? null,
    };
    const fix = createFixJobInStore(store, managed, syntheticReview, findings, {
      sourceCommentId: review?.id ?? null,
      reviewResult: 'changes_requested',
      now,
    });
    managed.activeReviewRequestId = requestId;
    managed.lastError = null;
    return clone(fix);
  });
  setPrReviewLabels(root, result.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.changesRequested],
    remove: [PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.failed],
  });
  updateManualRun(root, result.issueNumber, {
    phase: 'manual-review-fix-queued',
    reason: null,
    completedAt: null,
  }, {
    type: 'manual-review-changes-requested',
    details: `Manual review requested changes on exact head ${expectedHeadSha}; a same-PR repair job was queued.`,
  });
  return result;
}

function recordManualApproval(root, managed, expectedHeadSha) {
  const state = loadRun(root, managed.issueNumber);
  const already = (state?.events || []).some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.commit === expectedHeadSha
    && event.source === 'manual-review');
  if (!already) {
    recordEvent(root, managed.issueNumber, {
      event: 'review',
      result: 'APPROVED',
      commit: expectedHeadSha,
      details: 'Manual GitHub review approved this exact validated commit.',
      source: 'manual-review',
    });
  }
  markHumanReview(root, managed.issueNumber, managed.pullRequestNumber);
  return mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managed.id);
    if (!record) return null;
    const at = nowIso();
    record.lastCompletedReviewSha = expectedHeadSha;
    record.lastProcessedReviewRequestId = manualRequestId(record.id, expectedHeadSha);
    record.activeReviewRequestId = null;
    record.lastError = null;
    transitionManaged(store, record, 'ready_to_merge', {
      reason: 'Manual review approved the exact validated head; automatic merge remains disabled for the manual workflow.',
      actor: 'manual-review-reconciliation',
      sha: expectedHeadSha,
      at,
    });
    return clone(record);
  });
}

function markClosedUnmerged(root, managed) {
  const message = `PR #${managed.pullRequestNumber} was closed without merge during manual review.`;
  mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managed.id);
    if (!record) return;
    transitionManaged(store, record, 'closed_unmerged', {
      reason: message,
      actor: 'manual-review-reconciliation',
      sha: record.currentHeadSha,
    });
    record.lastError = message;
    record.activeReviewRequestId = null;
  });
  const labels = run('gh', ['issue', 'edit', String(managed.issueNumber), '--add-label', PASEO_LABELS.needsAttention], {
    cwd: root,
    allowFailure: true,
  });
  if (!labels.ok) throw new Error(labels.stderr || labels.stdout || message);
  updateManualRun(root, managed.issueNumber, {
    status: PASEO_LABELS.needsAttention,
    phase: 'review-attention',
    reason: message,
    completedAt: nowIso(),
  }, {
    type: 'manual-review-closed-unmerged',
    details: message,
  });
  return { state: 'closed_unmerged', needsOperator: true };
}

function rehandoffValidatedExternalHead(root, managed, runState, pr) {
  const head = String(pr?.headRefOid || '').toLowerCase();
  const validation = latestValidation(runState, head);
  if (!validation) {
    const message = `Manual-review PR #${managed.pullRequestNumber} moved from ${runState.reviewExpectedHeadSha || managed.currentHeadSha} to ${head} without exact-head validation evidence.`;
    mutatePrReviewStore(root, (store) => {
      const record = findManaged(store, managed.id);
      if (record) record.lastError = message;
    });
    updateManualRun(root, managed.issueNumber, {
      phase: 'manual-review-stale-head',
      reason: message,
    }, { type: 'manual-review-stale-head', details: message });
    return { state: 'stale', needsOperator: true, reason: message };
  }
  enterManualReview(root, {
    pullRequestNumber: managed.pullRequestNumber,
    headSha: head,
    validationSummary: validation.details || `Validation passed for exact head ${head}.`,
    quickFindings: [],
    quickExhausted: false,
    isDraft: pr.isDraft === true,
  });
  mutatePrReviewStore(root, (store) => {
    const record = findManaged(store, managed.id);
    if (!record) return;
    record.currentHeadSha = head;
    record.reviewRound += 1;
    record.reviewState = 'paused';
    record.activeReviewRequestId = manualRequestId(record.id, head);
    record.lastError = null;
    record.updatedAt = nowIso();
  });
  updateManualRun(root, managed.issueNumber, {
    phase: 'manual-review',
    reviewExpectedHeadSha: head,
    reason: null,
    completedAt: null,
  }, {
    type: 'manual-review-requeued',
    details: `Manual review was reissued for newly validated exact head ${head}.`,
  });
  return { state: 'waiting-manual-review', rehandedOff: true, headSha: head };
}

export function reconcileManualReview(root, managedId, {
  snapshot = null,
  snapshotReader = managedPrSnapshot,
  now = Date.now(),
} = {}) {
  const store = loadPrReviewStore(root);
  const managed = findManaged(store, managedId);
  if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
  const runState = manualRun(root, managed);
  if (!runState) return { skipped: true, reason: 'Managed PR is not in the manual review workflow.' };
  if (!['paused', 'ready_to_merge'].includes(managed.reviewState)) {
    return { skipped: true, reason: `Manual review is currently ${managed.reviewState}.` };
  }
  const pr = snapshot || snapshotReader(root, managed.pullRequestNumber);
  if (!pr) throw new Error(`Could not read manual-review PR #${managed.pullRequestNumber}.`);
  const expectedHeadSha = String(runState.reviewExpectedHeadSha || managed.currentHeadSha || '').toLowerCase();
  const outcome = evaluateManualReviewSnapshot({ pr, expectedHeadSha });
  mutatePrReviewStore(root, (next) => {
    const record = findManaged(next, managed.id);
    if (record) record.lastReconciledAt = nowIso(now);
  });

  if (outcome.action === 'stale') return rehandoffValidatedExternalHead(root, managed, runState, pr);
  if (outcome.action === 'queue-fix') {
    return { state: 'fix_queued', fixJob: queueManualFix(root, managed.id, outcome.review, expectedHeadSha, { now }) };
  }
  if (outcome.action === 'manual-review-complete') {
    return { state: 'ready_to_merge', managed: recordManualApproval(root, managed, expectedHeadSha) };
  }
  if (outcome.action === 'merged-complete') {
    updateManualRun(root, managed.issueNumber, {
      phase: 'manual-review-merged-pending-finalization',
      reason: null,
    }, {
      type: 'manual-review-merge-observed',
      details: `Manual-review PR #${managed.pullRequestNumber} merged at exact head ${expectedHeadSha}; deterministic merge finalization is pending.`,
    });
    return { state: 'merged-pending-finalization', headSha: expectedHeadSha };
  }
  if (outcome.action === 'closed-unmerged') return markClosedUnmerged(root, managed);
  return { state: 'waiting-manual-review', headSha: expectedHeadSha };
}

export function reconcileManualReviews(root, options = {}) {
  const store = loadPrReviewStore(root);
  const records = store.managedPullRequests.filter((managed) => manualRun(root, managed));
  const result = { checked: 0, changed: 0, errors: [] };
  for (const managed of records) {
    try {
      const outcome = reconcileManualReview(root, managed.id, options);
      result.checked += 1;
      if (!outcome.skipped && outcome.state !== 'waiting-manual-review') result.changed += 1;
    } catch (error) {
      result.checked += 1;
      result.errors.push({ managedPullRequestId: managed.id, error: error.message });
      mutatePrReviewStore(root, (next) => {
        const record = findManaged(next, managed.id);
        if (record) {
          record.lastError = error.message;
          record.lastReconciledAt = nowIso(options.now || Date.now());
        }
      });
    }
  }
  return result;
}
