import { browserDoctor } from './browser-service.mjs';
import { loadBrowserConfig } from './browser-profile.mjs';
import { loadPrReviewStore, TERMINAL_PR_STATES } from './pr-review-store.mjs';
import { resolveConversationUrl } from './pr-review-worker.mjs';

export function prReviewStatus(root) {
  const store = loadPrReviewStore(root);
  const activeJob = store.runtime.activeReviewJobId
    ? store.reviewJobs.find((job) => job.id === store.runtime.activeReviewJobId) || null
    : store.reviewJobs.find((job) => job.state === 'submitting') || null;
  const waiting = store.reviewJobs
    .filter((job) => job.state === 'queued')
    .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(a.queuePosition) - Number(b.queuePosition));
  const globalConfig = loadBrowserConfig();
  const managed = store.managedPullRequests.map((record) => {
    const currentJob = store.reviewJobs
      .filter((job) => job.managedPullRequestId === record.id && !['completed', 'superseded', 'cancelled'].includes(job.state))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
    const fixJob = store.fixJobs
      .filter((job) => job.managedPullRequestId === record.id && !['completed', 'cancelled'].includes(job.state))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
    return {
      ...record,
      terminal: TERMINAL_PR_STATES.has(record.reviewState),
      currentReviewJob: currentJob,
      currentFixJob: fixJob,
      resolvedConversationUrl: currentJob ? resolveConversationUrl(store, record, currentJob, globalConfig) : record.conversationUrlOverride || store.config.browserReview.projectConversationUrl || globalConfig.globalConversationUrl || null,
    };
  });
  return {
    config: store.config,
    runtime: store.runtime,
    activeReview: activeJob,
    waitingReviews: waiting,
    managedPullRequests: managed,
    fixJobs: store.fixJobs,
    history: [...store.history].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 500),
    browser: browserDoctor(),
    globalConversationUrl: globalConfig.globalConversationUrl,
  };
}
