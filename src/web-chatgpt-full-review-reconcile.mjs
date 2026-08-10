import { PASEO_LABELS, PR_REVIEW_LABELS } from './label-catalog.mjs';
import {
  finalizeApprovedPullRequest,
  prepareManagedFinalizationEvidence,
} from './approved-pr-finalization.mjs';
import { managerPrHealthSnapshot, setPrReviewLabels } from './pr-review-github.mjs';
import {
  reconcileManagedPullRequest,
  reconcileManagedPullRequests,
  recoverPrReviewState,
} from './pr-review-reconcile.mjs';
import {
  appendHistory,
  findManaged,
  loadPrReviewStore,
  mutatePrReviewStore,
  nowIso,
  transitionManaged,
} from './pr-review-store.mjs';
import { run } from './process.mjs';
import { loadConfig, loadRun } from './state.mjs';
import {
  recordWebChatGptFullReviewMetadata,
  webChatGptFullReviewMetadata,
} from './web-chatgpt-full-review.mjs';

function exhaustedFixes(root) {
  const store = loadPrReviewStore(root);
  return store.fixJobs.flatMap((fix) => {
    if (!['queued', 'interrupted'].includes(fix.state)) return [];
    const metadata = webChatGptFullReviewMetadata(root, fix.reviewJobId);
    if (!metadata || metadata.stage !== 'full') return [];
    if (Number(metadata.stageRound) < Number(metadata.maxStageRounds)) return [];
    return [{ fix, metadata }];
  });
}

function applyNeedsAttentionLabels(root, managed) {
  setPrReviewLabels(root, managed.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.changesRequested],
    remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed, PR_REVIEW_LABELS.fixing],
  });
  const result = run('gh', [
    'issue', 'edit', String(managed.issueNumber),
    '--add-label', PASEO_LABELS.needsAttention,
  ], { cwd: root, allowFailure: true });
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `Could not add ${PASEO_LABELS.needsAttention} to issue #${managed.issueNumber}.`);
  }
}

function cancelExhaustedFix(root, entry, { now = Date.now(), applyLabels = applyNeedsAttentionLabels } = {}) {
  const at = nowIso(now);
  const result = mutatePrReviewStore(root, (store) => {
    const fix = store.fixJobs.find((job) => job.id === entry.fix.id);
    if (!fix || !['queued', 'interrupted'].includes(fix.state)) return null;
    const managed = findManaged(store, fix.managedPullRequestId);
    if (!managed) throw new Error(`Managed PR ${fix.managedPullRequestId} was not found.`);
    const previous = fix.state;
    fix.state = 'cancelled';
    fix.completedAt = at;
    fix.updatedAt = at;
    fix.lastError = `Full Web ChatGPT review reached round ${entry.metadata.stageRound} of ${entry.metadata.maxStageRounds}; automatic fixes stopped.`;
    appendHistory(store, {
      entityType: 'fix_job',
      entityId: fix.id,
      previousState: previous,
      newState: 'cancelled',
      reason: fix.lastError,
      actor: 'review-reconciliation',
      sha: fix.reviewedHeadSha,
      timestamp: at,
    });
    managed.lastError = `Full Web ChatGPT review exhausted ${entry.metadata.maxStageRounds} review rounds with unresolved changes.`;
    transitionManaged(store, managed, 'failed', {
      reason: managed.lastError,
      actor: 'review-reconciliation',
      sha: managed.currentHeadSha,
      at,
    });
    managed.activeReviewRequestId = null;
    return { managed: { ...managed }, cancelledFixJobId: fix.id };
  });
  if (!result) return null;
  applyLabels(root, result.managed);
  return {
    managedId: result.managed.id,
    cancelledFixJobId: result.cancelledFixJobId,
    fullReviewRound: entry.metadata.stageRound,
    fullReviewRoundLimit: entry.metadata.maxStageRounds,
  };
}

function carryFullReviewMetadataToCurrentHeads(root) {
  let config;
  try { config = loadConfig(root); } catch { return []; }
  if (config.review?.workflow !== 'quick-web-chatgpt') return [];
  const store = loadPrReviewStore(root);
  const carried = [];
  for (const managed of store.managedPullRequests) {
    const current = store.reviewJobs
      .filter((job) => job.managedPullRequestId === managed.id
        && job.headSha === managed.currentHeadSha
        && ['queued', 'submitting', 'awaiting_result'].includes(job.state))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!current || webChatGptFullReviewMetadata(root, current.id)) continue;
    const prior = store.reviewJobs
      .filter((job) => job.managedPullRequestId === managed.id && job.id !== current.id)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((job) => ({ job, metadata: webChatGptFullReviewMetadata(root, job.id) }))
      .find((entry) => entry.metadata?.stage === 'full');
    if (!prior) continue;
    const nextRound = Number(prior.metadata.stageRound) + 1;
    if (nextRound > Number(prior.metadata.maxStageRounds)) continue;
    const metadata = recordWebChatGptFullReviewMetadata(root, current.id, {
      stageRound: nextRound,
      maxStageRounds: prior.metadata.maxStageRounds,
      quickFindings: prior.metadata.quickFindings,
    });
    carried.push({ reviewJobId: current.id, headSha: current.headSha, metadata });
  }
  return carried;
}

function finalizeReadyManagedApprovals(root, options = {}) {
  const config = loadConfig(root);
  if (config.review?.workflow !== 'quick-web-chatgpt') return [];
  const store = loadPrReviewStore(root);
  const finalized = [];
  for (const managed of store.managedPullRequests) {
    if (managed.reviewState !== 'ready_to_merge') continue;
    const state = loadRun(root, managed.issueNumber);
    if (!state || state.reviewRuntimeStage === 'full-manual') continue;
    const pr = managerPrHealthSnapshot(root, managed.pullRequestNumber);
    if (!pr || String(pr.state || '').toUpperCase() !== 'OPEN') continue;
    const result = finalizeApprovedPullRequest(root, {
      repository: managed.repository,
      issueNumber: managed.issueNumber,
      issueUrl: managed.issueUrl,
      pullRequest: pr,
      state,
      findings: [],
      unresolvedFindings: false,
      approvalSource: 'browser-review',
      paseoOwned: String(pr.headRefName || '') === String(managed.branchName || '')
        && String(pr.headRefOid || '').toLowerCase() === String(managed.currentHeadSha || '').toLowerCase(),
    }, options);
    finalized.push({ managedId: managed.id, result });
  }
  return finalized;
}

export function enforceWebChatGptFullReviewLimits(root, options = {}) {
  const exhausted = exhaustedFixes(root);
  const stopped = exhausted
    .map((entry) => cancelExhaustedFix(root, entry, options))
    .filter(Boolean);
  const carried = carryFullReviewMetadataToCurrentHeads(root);
  return { stopped, carried };
}

export function reconcileManagedPullRequestWithWebFullReview(root, managedId, options = {}) {
  const preparedFinalization = prepareManagedFinalizationEvidence(root);
  const outcome = reconcileManagedPullRequest(root, managedId, options);
  const runtime = enforceWebChatGptFullReviewLimits(root, options);
  const finalization = finalizeReadyManagedApprovals(root, options);
  return { ...outcome, webChatGptFullReview: runtime, preparedFinalization, finalization };
}

export function reconcileManagedPullRequestsWithWebFullReview(root, options = {}) {
  const preparedFinalization = prepareManagedFinalizationEvidence(root);
  const outcome = reconcileManagedPullRequests(root, options);
  const runtime = enforceWebChatGptFullReviewLimits(root, options);
  const finalization = finalizeReadyManagedApprovals(root, options);
  return { ...outcome, webChatGptFullReview: runtime, preparedFinalization, finalization };
}

export function recoverPrReviewStateWithWebFullReview(root, options = {}) {
  const preparedFinalization = prepareManagedFinalizationEvidence(root);
  const outcome = recoverPrReviewState(root, options);
  const runtime = enforceWebChatGptFullReviewLimits(root, options);
  const finalization = finalizeReadyManagedApprovals(root, options);
  return { ...outcome, webChatGptFullReview: runtime, preparedFinalization, finalization };
}
