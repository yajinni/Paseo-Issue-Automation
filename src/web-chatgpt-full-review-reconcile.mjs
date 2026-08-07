import { PASEO_LABELS, PR_REVIEW_LABELS } from './label-catalog.mjs';
import { setPrReviewLabels } from './pr-review-github.mjs';
import {
  reconcileManagedPullRequest,
  reconcileManagedPullRequests,
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
import { webChatGptFullReviewMetadata } from './web-chatgpt-full-review.mjs';

function exhaustionForOutcome(root, managedId, outcome) {
  const fixJobId = outcome?.review?.fixJobId;
  if (!fixJobId || outcome?.review?.result !== 'changes_requested') return null;
  const store = loadPrReviewStore(root);
  const fix = store.fixJobs.find((job) => job.id === fixJobId && job.managedPullRequestId === managedId);
  if (!fix) return null;
  const metadata = webChatGptFullReviewMetadata(root, fix.reviewJobId);
  if (!metadata || metadata.stage !== 'full') return null;
  if (Number(metadata.stageRound) < Number(metadata.maxStageRounds)) return null;
  return { fix, metadata };
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

export function enforceWebChatGptFullReviewLimit(root, managedId, outcome, { now = Date.now() } = {}) {
  const exhaustion = exhaustionForOutcome(root, managedId, outcome);
  if (!exhaustion) return { enforced: false, outcome };
  const at = nowIso(now);
  const result = mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
    const fix = store.fixJobs.find((job) => job.id === exhaustion.fix.id);
    if (fix && !['completed', 'cancelled'].includes(fix.state)) {
      const previous = fix.state;
      fix.state = 'cancelled';
      fix.completedAt = at;
      fix.updatedAt = at;
      fix.lastError = `Full Web ChatGPT review reached round ${exhaustion.metadata.stageRound} of ${exhaustion.metadata.maxStageRounds}; automatic fixes stopped.`;
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
    }
    managed.lastError = `Full Web ChatGPT review exhausted ${exhaustion.metadata.maxStageRounds} review rounds with unresolved changes.`;
    transitionManaged(store, managed, 'failed', {
      reason: managed.lastError,
      actor: 'review-reconciliation',
      sha: managed.currentHeadSha,
      at,
    });
    managed.activeReviewRequestId = null;
    return {
      managed: { ...managed },
      metadata: { ...exhaustion.metadata },
      cancelledFixJobId: fix?.id || null,
    };
  });
  applyNeedsAttentionLabels(root, result.managed);
  return {
    enforced: true,
    outcome: {
      ...outcome,
      state: 'failed',
      review: {
        ...outcome.review,
        exhausted: true,
        stopAutomaticFixes: true,
        fullReviewRound: result.metadata.stageRound,
        fullReviewRoundLimit: result.metadata.maxStageRounds,
        cancelledFixJobId: result.cancelledFixJobId,
      },
    },
  };
}

export function reconcileManagedPullRequestWithWebFullReview(root, managedId, options = {}) {
  const outcome = reconcileManagedPullRequest(root, managedId, options);
  return enforceWebChatGptFullReviewLimit(root, managedId, outcome, options).outcome;
}

export function reconcileManagedPullRequestsWithWebFullReview(root, options = {}) {
  const outcome = reconcileManagedPullRequests(root, options);
  const entries = Array.isArray(outcome) ? outcome : outcome?.results;
  if (!Array.isArray(entries)) return outcome;
  const adjusted = entries.map((entry) => {
    const managedId = entry.managedId || entry.id;
    if (!managedId) return entry;
    return enforceWebChatGptFullReviewLimit(root, managedId, entry, options).outcome;
  });
  return Array.isArray(outcome) ? adjusted : { ...outcome, results: adjusted };
}
