import { registerManagedPullRequest } from './pr-review-queue.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { PR_REVIEW_LABELS, ensurePrReviewLabels, setPrReviewLabels } from './pr-review-github.mjs';
import { loadRun, saveRun } from './state.mjs';
import { run } from './process.mjs';

export function prReviewAutomationEnabled(root) {
  const config = loadPrReviewStore(root).config;
  return config.enabled && config.browserReview.enabled;
}

export function handoffValidatedPullRequest(root, {
  repository,
  issue,
  state,
  pr,
  headSha,
}) {
  ensurePrReviewLabels(root);
  const registered = registerManagedPullRequest(root, {
    repository,
    issueNumber: issue.number,
    issueUrl: issue.url,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    branchName: state.branch,
    worktreePath: state.worktreePath,
    workspaceId: state.workspaceId,
    coderAgentId: state.coderAgentId || state.agentId,
    currentHeadSha: headSha,
    reviewRound: 1,
  });
  setPrReviewLabels(root, pr.number, {
    add: [PR_REVIEW_LABELS.queued],
    remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.changesRequested, PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.failed],
  });
  run('gh', ['issue', 'edit', String(issue.number), '--remove-label', 'agent-running'], { cwd: root, allowFailure: true });
  run('gh', ['issue', 'comment', String(issue.number), '--body', `Coding completed for PR #${pr.number}. The coding slot was released and the PR entered Paseo's serial review queue at ${headSha}.`], {
    cwd: root, allowFailure: true,
  });
  const current = loadRun(root, issue.number) || state;
  const at = new Date().toISOString();
  saveRun(root, issue.number, {
    ...current,
    status: 'pr-review-queued',
    phase: 'review-queued',
    prNumber: pr.number,
    prUrl: pr.url,
    completedAt: at,
    updatedAt: at,
    heartbeatAt: at,
    activity: [...(current.activity || []), {
      type: 'pr-review-queued',
      at,
      details: `PR #${pr.number} queued for serial ChatGPT review at ${headSha}; coding slot released.`,
    }],
  });
  return registered;
}
