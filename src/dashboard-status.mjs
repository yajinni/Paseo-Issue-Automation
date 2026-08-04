import { dependencyNumbers, detectDependencyCycles, executionWaves, relationshipNodes } from './dependencies.mjs';
import { activeFixJobs } from './fix-jobs.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { LABELS, listRuns, loadConfig, loadRuntime } from './state.mjs';
import { run, runJson } from './process.mjs';

const STATUS_ORDER = Object.freeze([
  ['humanReview', 'human-review'],
  ['running', 'agent-running'],
  ['blocked', 'automation-blocked'],
  ['failed', 'automation-failed'],
  ['ready', 'agent-ready'],
]);

function labelNames(issue) {
  return new Set((issue?.labels || []).map((label) => typeof label === 'string' ? label : label.name));
}

function issueStatus(issue) {
  const labels = labelNames(issue);
  const match = STATUS_ORDER.find(([key]) => labels.has(LABELS[key]));
  return match?.[1] || 'open';
}

function listByLabel(root, label, { jsonRunner = runJson } = {}) {
  return jsonRunner('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking',
  ], { cwd: root, allowFailure: true }) || [];
}

export function summarizePrChecks(checks = []) {
  const normalized = (Array.isArray(checks) ? checks : []).map((check) => ({
    name: check.name || check.context || check.workflowName || 'check',
    state: String(check.conclusion || check.state || check.status || 'UNKNOWN').toUpperCase(),
    url: check.detailsUrl || check.targetUrl || null,
  }));
  const failed = normalized.filter((check) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.state));
  const pending = normalized.filter((check) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING', 'UNKNOWN'].includes(check.state));
  return {
    state: failed.length ? 'failed' : pending.length ? 'pending' : normalized.length ? 'passed' : 'none',
    total: normalized.length,
    failed: failed.length,
    pending: pending.length,
    checks: normalized,
  };
}

function prHealth(root, state, { jsonRunner = runJson } = {}) {
  if (!state?.prNumber && !state?.branch) return null;
  const args = state.prNumber
    ? ['pr', 'view', String(state.prNumber)]
    : ['pr', 'list', '--state', 'open', '--head', String(state.branch), '--limit', '1'];
  args.push('--json', 'number,url,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup');
  const result = jsonRunner('gh', args, { cwd: root, allowFailure: true });
  const pr = Array.isArray(result) ? result[0] : result;
  if (!pr) return null;
  return {
    number: Number(pr.number),
    url: pr.url || null,
    isDraft: pr.isDraft === true,
    head: pr.headRefOid || null,
    base: pr.baseRefName || null,
    mergeable: pr.mergeable || null,
    mergeStateStatus: pr.mergeStateStatus || null,
    checks: summarizePrChecks(pr.statusCheckRollup),
  };
}

function baseFreshness(root, state, baseBranch, { runner = run } = {}) {
  if (!state?.branch && !state?.worktreePath) return { state: 'unknown', baseBranch };
  const cwd = state.worktreePath || root;
  const result = runner('git', ['merge-base', '--is-ancestor', `refs/remotes/origin/${baseBranch}`, 'HEAD'], {
    cwd,
    allowFailure: true,
  });
  return {
    state: result?.ok ? 'current' : 'behind-or-unknown',
    baseBranch,
  };
}

function latestEvent(state, eventName, result = null) {
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === eventName && (!result || event.result === result)) || null;
}

function summarizeAttempt(root, state, config, options) {
  const review = latestEvent(state, 'review');
  const validation = latestEvent(state, 'validation-summary', 'PASS');
  const inspectLivePr = [LABELS.running, LABELS.humanReview, 'agent-running', 'human-review'].includes(state.status);
  return {
    issueNumber: Number(state.issueNumber),
    issueTitle: state.issueTitle || `Issue #${state.issueNumber}`,
    issueUrl: state.issueUrl || null,
    status: state.status || null,
    phase: state.phase || null,
    branch: state.branch || null,
    attempt: Number(state.attempt || 1),
    dependencies: state.dependencies || [],
    dependencySource: state.dependencySource || null,
    reason: state.reason || null,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    heartbeatAt: state.heartbeatAt || null,
    workspaceId: state.workspaceId || null,
    prNumber: state.prNumber || null,
    prUrl: state.prUrl || null,
    reviewRound: (state.events || []).filter((event) => event.event === 'review').length,
    validation: validation ? {
      commit: validation.commit || null,
      details: validation.details || '',
      at: validation.at || null,
    } : null,
    review: review ? {
      commit: review.commit || null,
      result: review.result || null,
      findings: review.details || '',
      at: review.at || null,
    } : null,
    approvedCommit: state.approvedCommit || null,
    pr: inspectLivePr ? prHealth(root, state, options) : null,
    baseFreshness: inspectLivePr ? baseFreshness(root, state, config.baseBranch, options) : { state: 'not-checked', baseBranch: config.baseBranch },
    activity: state.activity || [],
    events: state.events || [],
    history: state.history || [],
  };
}

function flattenActivity(attempts) {
  return attempts
    .flatMap((attempt) => [
      ...(attempt.activity || []).map((entry) => ({ ...entry, issueNumber: attempt.issueNumber, issueTitle: attempt.issueTitle })),
      ...(attempt.events || []).map((entry) => ({
        type: entry.event,
        at: entry.at,
        result: entry.result,
        commit: entry.commit,
        details: entry.details,
        issueNumber: attempt.issueNumber,
        issueTitle: attempt.issueTitle,
      })),
    ])
    .filter((entry) => entry.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function buildExecutionModel({ issues = [], attempts = [], config, runtime, activeFixCount = 0 }) {
  const graph = Object.fromEntries(issues.map((issue) => [issue.number, issue.dependencies || []]));
  const cycles = detectDependencyCycles(graph);
  const waveResult = executionWaves(graph);
  const byNumber = new Map(issues.map((issue) => [Number(issue.number), issue]));
  const waves = waveResult.waves.map((numbers, index) => ({
    number: index + 1,
    issues: numbers.map((number) => byNumber.get(number)).filter(Boolean),
  }));
  const running = attempts.filter((attempt) => attempt.status === LABELS.running || attempt.status === 'agent-running');
  const humanReview = attempts.filter((attempt) => attempt.status === LABELS.humanReview || attempt.status === 'human-review');
  const issueActive = running.length;
  const fixActive = Math.max(0, Number(activeFixCount) || 0);
  const totalActive = issueActive + fixActive;
  const maximum = Number(config.maxActive || 1);
  const intervalMs = Number(config.pollIntervalSeconds || 120) * 1000;
  const lastDispatchAt = runtime.lastDispatchAt || null;
  const nextPollAt = lastDispatchAt ? new Date(new Date(lastDispatchAt).getTime() + intervalMs).toISOString() : null;
  return {
    graph,
    waves,
    unresolvedWaveIssues: waveResult.unresolved,
    cycles,
    capacity: {
      active: totalActive,
      issueActive,
      fixActive,
      maximum,
      available: Math.max(0, maximum - totalActive),
    },
    humanReview,
    active: running,
    recentActivity: flattenActivity(attempts).slice(0, 100),
    lastDispatchAt,
    nextPollAt,
    lastDispatchResult: runtime.lastDispatchResult || null,
  };
}

export function dashboardStatus(root, existing = {}, options = {}) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const skipped = new Set(runtime.skippedIssueNumbers || []);
  const labelEntries = Object.entries(LABELS).map(([key, label]) => [key, listByLabel(root, label, options)]);
  const issueMap = new Map();
  for (const [, list] of labelEntries) {
    for (const issue of list) issueMap.set(Number(issue.number), issue);
  }
  const rawRuns = listRuns(root);
  for (const state of rawRuns) {
    if (!issueMap.has(Number(state.issueNumber))) {
      issueMap.set(Number(state.issueNumber), {
        number: Number(state.issueNumber),
        title: state.issueTitle || `Issue #${state.issueNumber}`,
        url: state.issueUrl || null,
        labels: [{ name: state.status }],
        blockedBy: (state.dependencies || []).map((number) => ({ number })),
      });
    }
  }
  const attempts = rawRuns.map((state) => summarizeAttempt(root, state, config, options));
  const existingReadyByIssue = new Map((existing.readyIssues || []).map((issue) => [Number(issue.number), issue]));
  const attemptsByIssue = new Map(attempts.map((attempt) => [attempt.issueNumber, attempt]));
  const issues = [...issueMap.values()].map((issue) => {
    const declared = dependencyNumbers(issue);
    const attempt = attemptsByIssue.get(Number(issue.number));
    return {
      number: Number(issue.number),
      title: issue.title || `Issue #${issue.number}`,
      url: issue.url || null,
      createdAt: issue.createdAt || null,
      status: issueStatus(issue),
      phase: attempt?.phase || null,
      dependencies: declared.numbers,
      dependencyUnavailable: declared.unavailable === true,
      blocking: (relationshipNodes(issue.blocking) || []).map((item) => Number(item.number)).filter(Number.isInteger),
      skipped: skipped.has(Number(issue.number)),
      branchExists: existingReadyByIssue.get(Number(issue.number))?.branchExists === true,
      branch: attempt?.branch || null,
      prNumber: attempt?.prNumber || null,
      prUrl: attempt?.prUrl || null,
      reason: attempt?.reason || null,
      reviewRound: attempt?.reviewRound || 0,
      validation: attempt?.validation || null,
      review: attempt?.review || null,
      pr: attempt?.pr || null,
      baseFreshness: attempt?.baseFreshness || null,
    };
  }).sort((a, b) => a.number - b.number);
  const activeFixCount = activeFixJobs(loadPrReviewStore(root)).length;
  const model = buildExecutionModel({ issues, attempts, config, runtime, activeFixCount });
  return {
    ...existing,
    counts: Object.fromEntries(labelEntries.map(([key, list]) => [key, list.length])),
    issues,
    attempts,
    readyIssues: issues.filter((issue) => issue.status === LABELS.ready || issue.status === 'agent-ready'),
    controller: {
      claimsEnabled: runtime.claimsEnabled === true,
      dependencyApiAvailable: issues.every((issue) => !issue.dependencyUnavailable),
      pollIntervalSeconds: Number(config.pollIntervalSeconds || 120),
      ...model,
    },
  };
}
