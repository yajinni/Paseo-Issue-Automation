import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserPaths } from './browser-profile.mjs';
import { submitReviewPrompt } from './browser-service.mjs';
import { expiredProfileSession } from './chatgpt-profile-readiness.mjs';
import { appendControllerLog } from './controller-log.mjs';
import { releaseLease, startLeaseHeartbeat } from './durable-lease.mjs';
import { PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';
import { markReviewSubmitted, markReviewSubmissionFailed } from './pr-review-queue.mjs';
import { findManaged, findReviewJob, loadPrReviewStore, mutatePrReviewStore } from './pr-review-store.mjs';
import {
  pauseWebReviewsForExpiredProfile,
  renderWebChatGptFullReviewPrompt,
  webChatGptFullReviewMetadata,
} from './web-chatgpt-full-review.mjs';

const GLOBAL_REVIEW_TTL_MS = 180_000;

function safeLog(root, input) {
  try { return appendControllerLog(root, { category: 'pr-reviews', source: 'automation', ...input }); }
  catch { return null; }
}

export function resolveFullReviewConversationUrl(store, managed, job) {
  return job.conversationUrlOverride
    || managed.conversationUrlOverride
    || store.config.browserReview.projectConversationUrl
    || null;
}

export async function executeWebChatGptFullReviewSubmission(root, jobId, {
  submitter = submitReviewPrompt,
} = {}) {
  const store = loadPrReviewStore(root);
  const job = findReviewJob(store, jobId);
  if (!job) throw new Error(`Review job ${jobId} was not found.`);
  if (job.state !== 'submitting') throw new Error(`Review job ${jobId} is not in submitting state.`);
  const managed = findManaged(store, job.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${job.managedPullRequestId} was not found.`);
  if (managed.currentHeadSha !== job.headSha) throw new Error('The PR head changed before Web ChatGPT full-review submission began.');
  const metadata = webChatGptFullReviewMetadata(root, job.id);
  if (!metadata) throw new Error('Web ChatGPT full-review metadata is missing for the claimed review job.');
  const conversationUrl = resolveFullReviewConversationUrl(store, managed, job);
  if (!conversationUrl) throw new Error('No ChatGPT conversation is configured for this PR or project.');
  const prompt = renderWebChatGptFullReviewPrompt({ managed, job, metadata });

  safeLog(root, {
    action: 'submit-web-chatgpt-full-review',
    status: 'started',
    message: `Submitting Web ChatGPT full-review round ${metadata.stageRound} for PR #${managed.pullRequestNumber}.`,
    details: {
      reviewJobId: job.id,
      reviewRequestId: job.reviewRequestId,
      headSha: job.headSha,
      stage: metadata.stage,
      stageRound: metadata.stageRound,
      maxStageRounds: metadata.maxStageRounds,
    },
  });
  try {
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.reviewing],
      remove: [PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed],
    });
    const result = await submitter({ conversationUrl, prompt, reviewRequestId: job.reviewRequestId });
    const saved = markReviewSubmitted(root, job.id, result);
    safeLog(root, {
      action: 'submit-web-chatgpt-full-review',
      status: 'success',
      message: `Web ChatGPT full-review round ${metadata.stageRound} submitted for PR #${managed.pullRequestNumber}.`,
      details: { reviewJobId: job.id, reviewRequestId: job.reviewRequestId, headSha: job.headSha },
    });
    return saved;
  } catch (error) {
    const expired = expiredProfileSession(error);
    const saved = markReviewSubmissionFailed(root, job.id, error, error.diagnostics || {});
    if (expired) {
      mutatePrReviewStore(root, (next) => pauseWebReviewsForExpiredProfile(next, { reason: expired.message }));
      setPrReviewLabels(root, managed.pullRequestNumber, {
        add: [PR_REVIEW_LABELS.queued],
        remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.failed],
      });
      safeLog(root, {
        action: 'submit-web-chatgpt-full-review',
        status: 'paused',
        message: expired.message,
        details: {
          reviewJobId: job.id,
          reviewRequestId: job.reviewRequestId,
          headSha: job.headSha,
          failActivePullRequests: false,
        },
      });
      return { ...saved, profileSignInRequired: true, queuePaused: true };
    }
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.failed],
      remove: [PR_REVIEW_LABELS.reviewing],
    });
    safeLog(root, {
      level: 'error',
      action: 'submit-web-chatgpt-full-review',
      status: 'failed',
      message: `Web ChatGPT full-review submission failed for PR #${managed.pullRequestNumber}: ${error.message}`,
      details: { reviewJobId: job.id, reviewRequestId: job.reviewRequestId, headSha: job.headSha, error },
    });
    throw error;
  }
}

async function main() {
  const [root, jobId, globalLeaseId] = process.argv.slice(2);
  if (!root || !jobId) throw new Error('Usage: web-chatgpt-full-review-worker.mjs <repository-root> <review-job-id> [global-lease-id]');
  const resolvedRoot = path.resolve(root);
  const globalLock = browserPaths().reviewSchedulerLock;
  let leaseError = null;
  const stopHeartbeat = globalLeaseId
    ? startLeaseHeartbeat(globalLock, globalLeaseId, {
        ttlMs: GLOBAL_REVIEW_TTL_MS,
        intervalMs: 45_000,
        metadata: { repositoryRoot: resolvedRoot, reviewJobId: jobId, stage: 'full-web-chatgpt' },
        onError: (error) => { leaseError = error; },
      })
    : () => {};
  try {
    const result = await executeWebChatGptFullReviewSubmission(resolvedRoot, jobId);
    if (leaseError) throw leaseError;
    return result;
  } finally {
    stopHeartbeat();
    if (globalLeaseId) releaseLease(globalLock, globalLeaseId);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
