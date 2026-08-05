import { appendControllerLog } from './controller-log.mjs';

const ACTIONS = Object.freeze({
  '/api/install': ['setup', 'install-components', 'Install repository components'],
  '/api/install/issue-template': ['setup', 'install-issue-template', 'Install the issue template'],
  '/api/repair/issue-template': ['setup', 'repair-issue-template', 'Repair the issue template'],
  '/api/install/paseo-service': ['setup', 'install-paseo-service', 'Install the Paseo service'],
  '/api/repair/paseo-service': ['setup', 'repair-paseo-service', 'Repair the Paseo service'],
  '/api/install/labels': ['setup', 'install-labels', 'Install GitHub lifecycle labels'],
  '/api/repair/label': ['setup', 'repair-label', 'Repair a GitHub lifecycle label'],
  '/api/remove/issue-template': ['setup', 'remove-issue-template', 'Remove the managed issue template'],
  '/api/remove/paseo-integration': ['setup', 'remove-paseo-service', 'Remove the managed Paseo service'],
  '/api/remove/label': ['setup', 'remove-label', 'Remove a managed GitHub label'],
  '/api/remove/labels': ['setup', 'remove-labels', 'Remove managed GitHub labels'],
  '/api/workspace': ['setup', 'create-workspace', 'Create or reconnect the Paseo workspace'],
  '/api/remove/workspace': ['setup', 'remove-workspace', 'Archive the managed Paseo workspace'],
  '/api/self-test': ['setup', 'self-test', 'Run the setup self-test'],
  '/api/clear-state': ['maintenance', 'clear-local-state', 'Clear local controller state'],
  '/api/uninstall': ['maintenance', 'guided-uninstall', 'Run guided uninstall'],
  '/api/start-issue': ['issues', 'start-issue', 'Start a specific issue'],
  '/api/skip-issue': ['issues', 'skip-issue', 'Skip an issue'],
  '/api/unskip-issue': ['issues', 'unskip-issue', 'Return a skipped issue'],
  '/api/abandon-issue': ['issues', 'abandon-issue', 'Abandon an issue attempt'],
  '/api/restart-issue': ['issues', 'restart-issue', 'Restart an issue'],
  '/api/open-attempt-workspace': ['issues', 'open-workspace', 'Open an issue workspace'],
  '/api/reconcile': ['issues', 'reconcile-dependencies', 'Reconcile GitHub issue dependencies'],
  '/api/config': ['configuration', 'save-controller-config', 'Save controller configuration'],
  '/api/finish': ['setup', 'finish-setup', 'Finish setup'],
  '/api/resume': ['issues', 'resume-issues-processing', 'Resume Issues Processing'],
  '/api/pause': ['issues', 'stop-issues-processing', 'Stop Issues Processing'],
  '/api/pr-reviews/config': ['pr-reviews', 'save-pr-review-config', 'Save PR Review configuration'],
  '/api/pr-reviews/pause': ['pr-reviews', 'pause-pr-reviews', 'Pause PR Reviews'],
  '/api/pr-reviews/resume': ['pr-reviews', 'resume-pr-reviews', 'Resume PR Reviews'],
  '/api/pr-reviews/review-now': ['pr-reviews', 'queue-review', 'Queue a PR review'],
  '/api/pr-reviews/retry': ['pr-reviews', 'retry-review', 'Retry a PR review job'],
  '/api/pr-reviews/retry-fix': ['pr-reviews', 'retry-fix', 'Retry a PR fix job'],
  '/api/pr-reviews/move': ['pr-reviews', 'move-review', 'Reorder a PR review job'],
  '/api/pr-reviews/pause-pr': ['pr-reviews', 'pause-managed-pr', 'Pause a managed pull request'],
  '/api/pr-reviews/resume-pr': ['pr-reviews', 'resume-managed-pr', 'Resume a managed pull request'],
  '/api/pr-reviews/cancel': ['pr-reviews', 'cancel-review', 'Cancel a queued PR review'],
  '/api/pr-reviews/manual-result': ['pr-reviews', 'manual-review-result', 'Record a manual PR review result'],
  '/api/pr-reviews/send-to-coding': ['pr-reviews', 'dispatch-fix', 'Send requested PR changes to coding'],
  '/api/pr-reviews/reconcile': ['pr-reviews', 'force-sync-pr-states', 'Force Sync PR States'],
  '/api/pr-reviews/browser/install': ['browser', 'install-chromium', 'Install the ChatGPT automation browser'],
  '/api/pr-reviews/browser/open': ['browser', 'open-browser', 'Open the dedicated ChatGPT browser'],
  '/api/pr-reviews/browser/use-current': ['browser', 'select-gpt-chat', 'Select the current GPT chat'],
  '/api/pr-reviews/browser/close': ['browser', 'close-browser', 'Close the dedicated ChatGPT browser'],
  '/api/pr-reviews/browser/test': ['browser', 'test-gpt-chat', 'Test the selected GPT chat'],
  '/api/pr-reviews/browser/doctor': ['browser', 'browser-diagnostics', 'Run browser diagnostics'],
  '/api/pr-reviews/browser/reset': ['browser', 'reset-chatgpt-credentials', 'Reset ChatGPT credentials'],
  '/api/pr-reviews/browser/uninstall': ['browser', 'uninstall-browser', 'Uninstall browser automation state'],
  '/api/pr-reviews/closed/reopen': ['pr-reviews', 'reopen-pr', 'Reopen a closed pull request'],
  '/api/pr-reviews/closed/return-coding': ['pr-reviews', 'return-to-coding', 'Return a closed PR issue to coding'],
  '/api/pr-reviews/closed/backlog': ['pr-reviews', 'return-to-backlog', 'Return a closed PR issue to backlog'],
  '/api/pr-reviews/closed/cancel-issue': ['pr-reviews', 'cancel-associated-issue', 'Cancel an associated issue'],
  '/api/pr-reviews/closed/manual-resolved': ['pr-reviews', 'mark-manually-resolved', 'Mark a closed PR manually resolved'],
});

function safeRequestDetails(pathname, body = {}) {
  const details = {};
  const copy = (key, target = key) => {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') details[target] = body[key];
  };
  copy('issueNumber');
  copy('managedPullRequestId');
  copy('reviewJobId');
  copy('fixJobId');
  copy('label');
  copy('scope');
  copy('direction');
  copy('branchAction');
  copy('result', 'reviewResult');
  if (pathname === '/api/config') {
    details.baseBranch = body.baseBranch || null;
    details.pollIntervalSeconds = body.pollIntervalSeconds ?? null;
    details.maxActive = body.maxActive ?? null;
    details.maxReviewRounds = body.maxReviewRounds ?? null;
    details.modelsChanged = Boolean(body.models);
  }
  if (pathname === '/api/uninstall') {
    details.issueTemplate = body.issueTemplate === true;
    details.paseoService = body.paseoService === true;
    details.labels = body.labels === true;
    details.workspace = body.workspace === true;
    details.localState = body.localState === true;
  }
  if (pathname === '/api/pr-reviews/browser/test') details.sendTestPrompt = body.sendTestPrompt === true;
  if (pathname === '/api/pr-reviews/browser/install') details.withSystemDependencies = body.withSystemDependencies === true;
  return details;
}

function safeResultSummary(result) {
  if (result === null || result === undefined) return {};
  if (typeof result !== 'object') return { result };
  const summary = {};
  for (const key of [
    'created', 'installed', 'removed', 'repaired', 'managed', 'opened', 'closed', 'reset',
    'claimed', 'started', 'reviewed', 'submitted', 'queued', 'paused', 'enabled', 'pass', 'state',
    'number', 'issueNumber', 'pullRequestNumber', 'reviewJobId', 'fixJobId', 'reason',
  ]) {
    if (result[key] !== undefined) summary[key] = result[key];
  }
  if (result.pullRequest && typeof result.pullRequest === 'object') {
    summary.pullRequest = {
      number: result.pullRequest.number || null,
      state: result.pullRequest.state || null,
      branch: result.pullRequest.branch || null,
      baseBranch: result.pullRequest.baseBranch || null,
      url: result.pullRequest.url || null,
    };
  }
  if (Array.isArray(result)) summary.count = result.length;
  return summary;
}

export function describeApiAction(pathname, body = {}) {
  const [category, action, message] = ACTIONS[pathname] || ['controller', pathname.replace(/^\/api\//, '').replaceAll('/', '-'), pathname];
  return { category, action, message, details: safeRequestDetails(pathname, body) };
}

export function logApiActionStarted(root, pathname, body = {}) {
  const description = describeApiAction(pathname, body);
  return appendControllerLog(root, {
    level: 'info',
    category: description.category,
    action: description.action,
    status: 'started',
    source: 'operator',
    message: `${description.message} started.`,
    details: description.details,
  });
}

export function logApiActionSucceeded(root, pathname, body, result, startedAt) {
  const description = describeApiAction(pathname, body);
  return appendControllerLog(root, {
    level: 'info',
    category: description.category,
    action: description.action,
    status: 'success',
    source: 'operator',
    message: `${description.message} completed.`,
    details: {
      ...description.details,
      durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
      result: safeResultSummary(result),
    },
  });
}

export function logApiActionFailed(root, pathname, body, error, startedAt) {
  const description = describeApiAction(pathname, body);
  return appendControllerLog(root, {
    level: 'error',
    category: description.category,
    action: description.action,
    status: 'failed',
    source: 'operator',
    message: `${description.message} failed: ${error?.message || error}`,
    details: {
      ...description.details,
      durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
      error,
    },
  });
}

export function logAutomatedAction(root, input) {
  return appendControllerLog(root, {
    source: 'automation',
    ...input,
  });
}
