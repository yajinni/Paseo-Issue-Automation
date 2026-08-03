import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadBrowserConfig } from './browser-profile.mjs';
import { submitReviewPrompt } from './browser-service.mjs';
import { findManaged, findReviewJob, loadPrReviewStore } from './pr-review-store.mjs';
import { markReviewSubmitted, markReviewSubmissionFailed } from './pr-review-queue.mjs';
import { renderReviewPrompt } from './review-prompt.mjs';
import { PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';

export function resolveConversationUrl(store, managed, job, globalConfig = loadBrowserConfig()) {
  return job.conversationUrlOverride
    || managed.conversationUrlOverride
    || store.config.browserReview.projectConversationUrl
    || globalConfig.globalConversationUrl
    || null;
}

export async function executeReviewSubmission(root, jobId, {
  submitter = submitReviewPrompt,
  globalConfig = loadBrowserConfig(),
} = {}) {
  const store = loadPrReviewStore(root);
  const job = findReviewJob(store, jobId);
  if (!job) throw new Error(`Review job ${jobId} was not found.`);
  if (job.state !== 'submitting') throw new Error(`Review job ${jobId} is not in submitting state.`);
  const managed = findManaged(store, job.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${job.managedPullRequestId} was not found.`);
  if (managed.currentHeadSha !== job.headSha) throw new Error('The PR head changed before browser submission began.');
  const conversationUrl = resolveConversationUrl(store, managed, job, globalConfig);
  if (!conversationUrl) throw new Error('No ChatGPT conversation is configured for this PR, project, or global profile.');
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
  try {
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.reviewing],
      remove: [PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.failed],
    });
    const result = await submitter({ conversationUrl, prompt, reviewRequestId: job.reviewRequestId });
    return markReviewSubmitted(root, job.id, result);
  } catch (error) {
    setPrReviewLabels(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.failed],
      remove: [PR_REVIEW_LABELS.reviewing],
    });
    markReviewSubmissionFailed(root, job.id, error, error.diagnostics || {});
    throw error;
  }
}

async function main() {
  const [root, jobId] = process.argv.slice(2);
  if (!root || !jobId) throw new Error('Usage: pr-review-worker.mjs <repository-root> <review-job-id>');
  await executeReviewSubmission(path.resolve(root), jobId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
