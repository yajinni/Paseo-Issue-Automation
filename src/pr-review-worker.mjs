import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserPaths } from './browser-profile.mjs';
import { releaseLease, startLeaseHeartbeat } from './durable-lease.mjs';
import { submitReviewPrompt } from './browser-service.mjs';
import { appendControllerLog } from './controller-log.mjs';
import { findManaged, findReviewJob, loadPrReviewStore } from './pr-review-store.mjs';
import { markReviewSubmitted, markReviewSubmissionFailed } from './pr-review-queue.mjs';
import { renderReviewPrompt } from './review-prompt.mjs';
import { PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';

const GLOBAL_REVIEW_TTL_MS = 180_000;

function safeReviewLog(root, input) {
  try { return appendControllerLog(root, { category: 'pr-reviews', source: 'automation', ...input }); }
  catch (error) {
    console.error(JSON.stringify({ subsystem: 'controller-log', error: error.message }));
    return null;
  }
}

export function resolveConversationUrl(store, managed, job) {
  return job.conversationUrlOverride
    || managed.conversationUrlOverride
    || store.config.browserReview.projectConversationUrl
    || null;
}

export async function executeReviewSubmission(root, jobId, {
  submitter = submitReviewPrompt,
} = {}) {
  const store = loadPrReviewStore(root);
  const job = findReviewJob(store, jobId);
  if (!job) throw new Error(`Review job ${jobId} was not found.`);
  if (job.state !== 'submitting') throw new Error(`Review job ${jobId} is not in submitting state.`);
  const managed = findManaged(store, job.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${job.managedPullRequestId} was not found.`);
  if (managed.currentHeadSha !== job.headSha) throw new Error('The PR head changed before browser submission began.');
  const conversationUrl = resolveConversationUrl(store, managed, job);
  if (!conversationUrl) throw new Error('No ChatGPT conversation is configured for this PR or project.');
  const prompt = renderReviewPrompt({
    template: store.config.browserReview.reviewPromptTemplate,
    reviewPromptVersion: job.promptVersion,
    allowChatGPTMerge: store.config.githubActions.allowChatGPTMerge,
    allowIssueClosure: store.config.githubActions.allowChatGPTMerge && store.config.githubActions.allowPaseoIssueClosureFallback,
    reviewRequestId: job.reviewRequestId,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    pullRequestUrl: managed.pullRequestUrl,
    issueNumber: managed.issueNumber,
    issueUrl: managed.issueUrl || '',
    headSha: job.headSha,
    reviewRound: job.reviewRound,
  });
  safeReviewLog(root, {
    action: 'submit-pr-review',
    status: 'started',
    message: `Submitting ChatGPT review job ${job.id} for PR #${managed.pullRequestNumber}.`,
    details: {
      reviewJobId: job.id,
      reviewRequestId: job.reviewRequestId,
      managedPullRequestId: managed.id,
      pullRequestNumber: managed.pullRequestNumber,
      issueNumber: managed.issueNumber,
      headSha: job.headSha,
      reviewRound: job.reviewRound,
    },
  });
  try {
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.reviewing],
      remove: [PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed],
    });
    const result = await submitter({ conversationUrl, prompt, reviewRequestId: job.reviewRequestId });
    const saved = markReviewSubmitted(root, job.id, result);
    if (saved.state === 'superseded' || saved.state === 'cancelled') return saved;
    safeReviewLog(root, {
      action: 'submit-pr-review',
      status: 'success',
      message: `ChatGPT review job ${job.id} was submitted for PR #${managed.pullRequestNumber}.`,
      details: {
        reviewJobId: job.id,
        reviewRequestId: job.reviewRequestId,
        managedPullRequestId: managed.id,
        pullRequestNumber: managed.pullRequestNumber,
        issueNumber: managed.issueNumber,
        headSha: job.headSha,
        submittedAt: saved.submittedAt || result.submittedAt || null,
        recoveredExistingSubmission: result.recoveredExistingSubmission === true,
      },
    });
    return saved;
  } catch (error) {
    const saved = markReviewSubmissionFailed(root, job.id, error, error.diagnostics || {});
    if (saved.state === 'superseded' || saved.state === 'cancelled') return saved;
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.failed],
      remove: [PR_REVIEW_LABELS.reviewing],
    });
    safeReviewLog(root, {
      level: 'error',
      action: 'submit-pr-review',
      status: 'failed',
      message: `ChatGPT review job ${job.id} failed for PR #${managed.pullRequestNumber}: ${error.message}`,
      details: {
        reviewJobId: job.id,
        reviewRequestId: job.reviewRequestId,
        managedPullRequestId: managed.id,
        pullRequestNumber: managed.pullRequestNumber,
        issueNumber: managed.issueNumber,
        headSha: job.headSha,
        diagnostics: error.diagnostics || {},
        error,
      },
    });
    throw error;
  }
}

async function main() {
  const [root, jobId, globalLeaseId] = process.argv.slice(2);
  if (!root || !jobId) throw new Error('Usage: pr-review-worker.mjs <repository-root> <review-job-id> [global-lease-id]');
  const resolvedRoot = path.resolve(root);
  const globalLock = browserPaths().reviewSchedulerLock;
  let leaseError = null;
  const stopHeartbeat = globalLeaseId
    ? startLeaseHeartbeat(globalLock, globalLeaseId, {
        ttlMs: GLOBAL_REVIEW_TTL_MS,
        intervalMs: 45_000,
        metadata: { repositoryRoot: resolvedRoot, reviewJobId: jobId },
        onError: (error) => { leaseError = error; },
      })
    : () => {};
  try {
    const result = await executeReviewSubmission(resolvedRoot, jobId);
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
