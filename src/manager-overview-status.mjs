const INACTIVE_ISSUE_STAGES = new Set(['ready', 'waiting', 'completed', 'failed', 'abandoned', 'review-failed', 'needs-attention']);
const TERMINAL_PR_STAGES = new Set(['completed', 'failed', 'abandoned']);
const INTENTIONAL_STOP_CODES = new Set(['claims-paused', 'review-worker-stopped']);

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function timestamp(value) {
  const text = firstString(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? { text, time } : null;
}

function oldestFirst(left, right) {
  const a = timestamp(left.startedAt)?.time ?? Number.MAX_SAFE_INTEGER;
  const b = timestamp(right.startedAt)?.time ?? Number.MAX_SAFE_INTEGER;
  return a - b || Number(left.issueNumber || left.pullRequestNumber || 0) - Number(right.issueNumber || right.pullRequestNumber || 0);
}

function newestFirst(left, right) {
  const a = timestamp(left.at)?.time ?? 0;
  const b = timestamp(right.at)?.time ?? 0;
  return b - a;
}

function managedPullRequestFor(item, store = null) {
  if (!store || typeof store !== 'object') return null;
  const issueNumber = firstNumber(item?.issueNumber);
  const pullRequestNumber = firstNumber(item?.pullRequest?.number);
  return [...(store.managedPullRequests || [])]
    .filter((entry) => Number(entry?.issueNumber) === issueNumber)
    .filter((entry) => !pullRequestNumber || Number(entry?.pullRequestNumber) === pullRequestNumber)
    .sort((left, right) => String(right?.updatedAt || right?.createdAt || '').localeCompare(String(left?.updatedAt || left?.createdAt || '')))[0] || null;
}

function earliestTimelineTime(item, matcher) {
  const matches = [...(item?.timeline || [])]
    .filter((entry) => matcher(entry))
    .map((entry) => timestamp(entry?.at))
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  return matches[0]?.text || null;
}

function prStartTime(item, managed) {
  return firstString(
    managed?.createdAt,
    earliestTimelineTime(item, (entry) => /pull request|\bpr\b|draft/i.test(`${entry?.type || ''} ${entry?.detail || ''}`)),
    item?.reviewAutomation?.latestReviewJob?.submittedAt,
    item?.startedAt,
  );
}

function reviewLabel(item) {
  return firstString(item?.review?.label, item?.stageLabel) || 'Pull request';
}

function currentPrHealth(workQueue, issueNumber) {
  return workQueue?.prHealth?.byIssue?.[String(issueNumber)] || null;
}

function activeIssues(workQueue) {
  return (workQueue?.items || [])
    .filter((item) => item?.issueNumber && !INACTIVE_ISSUE_STAGES.has(String(item.stage || '')))
    .map((item) => ({
      issueNumber: Number(item.issueNumber),
      title: item.title || `Issue #${item.issueNumber}`,
      url: item.issueUrl || null,
      stage: item.stage || 'unknown',
      stageLabel: item.stageLabel || 'Unknown',
      startedAt: firstString(item.startedAt),
      updatedAt: firstString(item.updatedAt, item.startedAt),
    }))
    .sort(oldestFirst);
}

function activePullRequests(workQueue, store) {
  return (workQueue?.items || [])
    .filter((item) => item?.issueNumber && item?.pullRequest?.number)
    .map((item) => {
      const health = currentPrHealth(workQueue, item.issueNumber);
      const managed = managedPullRequestFor(item, store);
      const state = String(health?.currentPr?.state || '').toUpperCase();
      const closedUnmerged = state === 'CLOSED' && !health?.currentPr?.mergedAt;
      if (closedUnmerged || TERMINAL_PR_STAGES.has(String(item.stage || ''))) return null;
      return {
        pullRequestNumber: Number(item.pullRequest.number),
        url: item.pullRequest.url || health?.currentPr?.url || null,
        issueNumber: Number(item.issueNumber),
        issueTitle: item.title || `Issue #${item.issueNumber}`,
        stage: item.stage || 'unknown',
        stageLabel: item.stageLabel || 'Unknown',
        reviewType: reviewLabel(item),
        startedAt: prStartTime(item, managed),
        updatedAt: firstString(managed?.updatedAt, item.updatedAt, item.startedAt),
        health: health ? {
          status: health.status || 'unknown',
          label: health.label || null,
          tone: health.tone || 'neutral',
          problemCount: Number(health.problemCount || 0),
        } : null,
      };
    })
    .filter(Boolean)
    .sort(oldestFirst);
}

function attentionItems(status) {
  const result = [];
  for (const blocker of status?.blockers || []) {
    if (!blocker || INTENTIONAL_STOP_CODES.has(blocker.code)) continue;
    if (!['error', 'warning'].includes(String(blocker.severity || ''))) continue;
    result.push({
      key: `blocker:${blocker.code || blocker.title}`,
      kind: 'repository',
      title: blocker.title || blocker.code || 'Repository issue',
      detail: blocker.message || null,
      severity: blocker.severity || 'warning',
      at: null,
      action: blocker.action || null,
    });
  }
  for (const item of status?.workQueue?.items || []) {
    const health = currentPrHealth(status.workQueue, item.issueNumber);
    for (const problem of health?.problems || []) {
      if (!['blocking', 'attention'].includes(String(problem.severity || ''))) continue;
      result.push({
        key: `pr:${item.pullRequest?.number || item.issueNumber}:${problem.code}`,
        kind: 'pr',
        issueNumber: Number(item.issueNumber),
        pullRequestNumber: firstNumber(item.pullRequest?.number),
        title: problem.title || 'PR needs attention',
        detail: problem.message || null,
        severity: problem.severity === 'blocking' ? 'error' : 'warning',
        at: firstString(item.updatedAt),
        action: item.pullRequest?.url ? { kind: 'link', label: `Open PR #${item.pullRequest.number}`, url: item.pullRequest.url } : null,
      });
    }
  }
  const seen = new Set();
  return result.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  }).slice(0, 8);
}

function recentEntries(workQueue) {
  const entries = [];
  for (const item of workQueue?.items || []) {
    if (item.stage === 'completed') {
      entries.push({
        key: `issue:${item.issueNumber}:completed`,
        kind: 'issue-completed',
        issueNumber: Number(item.issueNumber),
        title: `Issue #${item.issueNumber} completed`,
        detail: item.title || null,
        at: firstString(item.completedAt, item.updatedAt),
        url: item.issueUrl || null,
      });
    }
    const health = currentPrHealth(workQueue, item.issueNumber);
    if (health?.currentPr?.mergedAt && item.pullRequest?.number) {
      entries.push({
        key: `pr:${item.pullRequest.number}:merged`,
        kind: 'pr-merged',
        issueNumber: Number(item.issueNumber),
        pullRequestNumber: Number(item.pullRequest.number),
        title: `PR #${item.pullRequest.number} merged`,
        detail: item.title || null,
        at: health.currentPr.mergedAt,
        url: item.pullRequest.url || health.currentPr.url || null,
      });
    }
    const reviewJob = item.reviewAutomation?.latestReviewJob;
    if (reviewJob?.completedAt && ['completed', 'approved', 'changes_requested'].includes(String(reviewJob.state || ''))) {
      entries.push({
        key: `review:${reviewJob.id || item.pullRequest?.number}:${reviewJob.completedAt}`,
        kind: 'review-completed',
        issueNumber: Number(item.issueNumber),
        pullRequestNumber: firstNumber(item.pullRequest?.number),
        title: item.pullRequest?.number ? `Review completed for PR #${item.pullRequest.number}` : `Review completed for issue #${item.issueNumber}`,
        detail: reviewJob.state === 'changes_requested' ? 'Changes requested' : 'Review completed',
        at: reviewJob.completedAt,
        url: item.pullRequest?.url || null,
      });
    }
  }
  const seen = new Set();
  return entries
    .filter((entry) => entry.at)
    .sort(newestFirst)
    .filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    })
    .slice(0, 8);
}

export function managerOverviewStatus(status = {}, { prReviewStore = null } = {}) {
  const workQueue = status.workQueue || {};
  return {
    activeIssues: activeIssues(workQueue),
    activePullRequests: activePullRequests(workQueue, prReviewStore),
    needsAttention: attentionItems(status),
    recent: recentEntries(workQueue),
  };
}
