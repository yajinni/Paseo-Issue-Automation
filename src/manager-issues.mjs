import { evaluateIssueQueue } from './issue-eligibility.mjs';
import { runJson } from './process.mjs';
import { listRuns, loadRuntime } from './state.mjs';

function issueFields() {
  return 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking';
}

function listOpenIssues(root, jsonRunner = runJson) {
  const rich = jsonRunner('gh', ['issue', 'list', '--state', 'open', '--limit', '1000', '--json', issueFields()], {
    cwd: root,
    allowFailure: true,
  });
  if (Array.isArray(rich)) return rich;
  const fallback = jsonRunner('gh', [
    'issue', 'list', '--state', 'open', '--limit', '1000',
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt',
  ], { cwd: root, allowFailure: true });
  if (!Array.isArray(fallback)) throw new Error('Could not list open GitHub issues for the manager issue plan.');
  return fallback;
}

function labels(issue) {
  return (issue?.labels || []).map((label) => typeof label === 'string' ? label : String(label?.name || '')).filter(Boolean);
}

function runByIssue(runs) {
  return new Map((runs || [])
    .filter((run) => Number.isInteger(Number(run?.issueNumber)))
    .map((run) => [Number(run.issueNumber), run]));
}

function activeRun(run) {
  if (!run || run.completedAt) return false;
  return !['waiting-for-dependencies', 'invalid-issue', 'ready', 'retry-pending'].includes(String(run.phase || ''))
    && Boolean(run.branch || run.workspaceId || run.agentId || run.coderAgentId || run.controllerPid || run.startedAt);
}

function activeLabel(run) {
  const phase = String(run?.phase || '');
  if (phase === 'restart-queued') return 'Restart queued';
  if (phase === 'restarting') return 'Restarting';
  if (phase === 'launch-retrying') return 'Retrying coding launch';
  if (phase === 'launch-reconciliation-needed') return 'Launch needs attention';
  if (phase === 'creating-workspace' || phase === 'verifying-workspace' || phase === 'starting-agent') return 'Starting coding';
  if (phase === 'coding') return 'Coding';
  if (phase === 'review-queued') return 'Review queued';
  if (phase === 'reviewing' || phase === 'review') return 'PR review';
  if (phase === 'changes-requested') return 'Changes requested';
  if (phase === 'fixing') return 'Fixing review changes';
  return 'Active';
}

function rejectionLabel(kind) {
  const labels = {
    'excluded-label': 'Excluded',
    'not-ready': 'Not selected',
    'invalid-contract': 'Issue template needs attention',
    'duplicate-claim': 'Already active',
    closed: 'Closed',
    'pull-request': 'Pull request',
    invalid: 'Invalid issue',
  };
  return labels[kind] || 'Not eligible';
}

export function managerIssuePlan(root, config, {
  jsonRunner = runJson,
  runtimeLoader = loadRuntime,
  runLister = listRuns,
  queueEvaluator = evaluateIssueQueue,
} = {}) {
  const issues = listOpenIssues(root, jsonRunner).sort((left, right) => Number(left.number) - Number(right.number));
  const runtime = runtimeLoader(root);
  const skipped = new Set((runtime.skippedIssueNumbers || []).map(Number));
  const runs = runByIssue(runLister(root));
  const queue = queueEvaluator(root, config, {
    issues,
    // The manager preview is read-only. It must not change issue/run state.
    recordInvalid: () => null,
    restoreInvalid: () => null,
    recordWait: () => null,
    recordReady: () => null,
  });
  const eligible = new Map(queue.eligible.map((entry) => [Number(entry.issue.number), entry]));
  const waiting = new Map(queue.waiting.map((entry) => [Number(entry.issueNumber), entry]));
  const rejected = new Map(queue.rejected.map((entry) => [Number(entry.issueNumber), entry]));
  const orderedEligible = queue.eligible
    .map((entry) => Number(entry.issue.number))
    .filter((number) => !skipped.has(number));
  const order = new Map(orderedEligible.map((number, index) => [number, index + 1]));

  const items = issues.map((issue) => {
    const number = Number(issue.number);
    const run = runs.get(number);
    const base = {
      issueNumber: number,
      title: issue.title || `Issue #${number}`,
      url: issue.url || null,
      labels: labels(issue),
      processingOrder: null,
      dependencies: [],
      status: 'Not eligible',
      statusId: 'rejected',
      reason: null,
      activePhase: run?.phase || null,
    };
    if (activeRun(run)) {
      return {
        ...base,
        status: activeLabel(run),
        statusId: 'active',
        dependencies: Array.isArray(run.dependencies) ? run.dependencies.map(Number) : [],
        reason: run.reason || 'This issue already has an active automation attempt.',
      };
    }
    if (skipped.has(number)) {
      const dependency = eligible.get(number)?.dependency;
      return {
        ...base,
        status: 'Skipped',
        statusId: 'skipped',
        dependencies: dependency?.dependencies || waiting.get(number)?.dependencies || [],
        reason: 'Skipped by the operator. It will not be selected until unskipped.',
      };
    }
    if (eligible.has(number)) {
      const entry = eligible.get(number);
      const position = order.get(number) || null;
      return {
        ...base,
        status: position === 1 ? 'Next eligible' : 'Eligible',
        statusId: position === 1 ? 'next' : 'eligible',
        processingOrder: position,
        dependencies: entry.dependency?.dependencies || [],
        reason: position === 1
          ? 'This is the next new issue selected when coding capacity is available.'
          : `Eligible after ${position - 1} earlier eligible issue${position === 2 ? '' : 's'} in issue-number order.`,
      };
    }
    if (waiting.has(number)) {
      const entry = waiting.get(number);
      return {
        ...base,
        status: 'Blocked by dependency',
        statusId: 'blocked',
        dependencies: entry.dependencies || [],
        reason: (entry.reasons || []).join(' ') || 'Native GitHub dependencies are not satisfied yet.',
      };
    }
    const rejection = rejected.get(number);
    return {
      ...base,
      status: rejectionLabel(rejection?.kind),
      statusId: rejection?.kind || 'rejected',
      reason: rejection?.reason || 'This issue does not match the current issue-processing rules.',
    };
  });

  return {
    mode: queue.mode,
    total: items.length,
    eligible: items.filter((item) => item.statusId === 'next' || item.statusId === 'eligible').length,
    blocked: items.filter((item) => item.statusId === 'blocked').length,
    skipped: items.filter((item) => item.statusId === 'skipped').length,
    active: items.filter((item) => item.statusId === 'active').length,
    nextIssueNumber: orderedEligible[0] || null,
    items,
  };
}
