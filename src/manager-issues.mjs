import { detectDependencyCycles, relationshipNodes } from './dependencies.mjs';
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

function normalizeRelationship(value) {
  if (!value || typeof value !== 'object') return null;
  const number = Number(value.number);
  if (!Number.isInteger(number) || number < 1) return null;
  return {
    number,
    title: value.title || `Issue #${number}`,
    state: String(value.state || '').toUpperCase(),
    stateReason: String(value.stateReason || '').toUpperCase(),
    url: value.url || null,
  };
}

function nativeRelationships(issue) {
  const blockedByNodes = relationshipNodes(issue?.blockedBy);
  const blockingNodes = relationshipNodes(issue?.blocking);
  const relationshipDataAvailable = blockedByNodes !== null;
  return {
    relationshipDataAvailable,
    relationshipDataReason: relationshipDataAvailable
      ? null
      : 'Native GitHub blocked-by relationship data is unavailable for this issue.',
    nativeBlockedBy: (blockedByNodes || []).map(normalizeRelationship).filter(Boolean),
    nativeBlocking: (blockingNodes || []).map(normalizeRelationship).filter(Boolean),
    nativeBlockingAvailable: blockingNodes !== null,
  };
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

function uniqueSortedNumbers(values = []) {
  return [...new Set(values.map(Number).filter((number) => Number.isInteger(number) && number > 0))]
    .sort((left, right) => left - right);
}

export function buildManagerOpenIssueGraph(items = []) {
  const byNumber = new Map(items
    .filter((item) => Number.isInteger(Number(item?.issueNumber)))
    .map((item) => [Number(item.issueNumber), item]));
  const issueNumbers = [...byNumber.keys()].sort((left, right) => left - right);
  const dependencies = {};
  const unlocks = Object.fromEntries(issueNumbers.map((number) => [number, []]));
  const resolvedDependencies = {};
  const externalDependencies = {};
  const unavailableIssueNumbers = [];
  let relationshipCount = 0;

  for (const number of issueNumbers) {
    const item = byNumber.get(number);
    if (item.relationshipDataAvailable === false) unavailableIssueNumbers.push(number);
    const internal = [];
    const resolved = [];
    const external = [];
    for (const dependency of item.nativeBlockedBy || []) {
      const dependencyNumber = Number(dependency?.number);
      if (!Number.isInteger(dependencyNumber) || dependencyNumber < 1) continue;
      if (byNumber.has(dependencyNumber)) {
        internal.push(dependencyNumber);
      } else if (String(dependency.state || '').toUpperCase() === 'CLOSED') {
        resolved.push(dependencyNumber);
      } else {
        external.push(dependencyNumber);
      }
    }
    dependencies[number] = uniqueSortedNumbers(internal);
    resolvedDependencies[number] = uniqueSortedNumbers(resolved);
    externalDependencies[number] = uniqueSortedNumbers(external);
    relationshipCount += dependencies[number].length;
  }

  for (const [numberText, blockers] of Object.entries(dependencies)) {
    const number = Number(numberText);
    for (const blocker of blockers) unlocks[blocker]?.push(number);
  }
  for (const number of issueNumbers) unlocks[number] = uniqueSortedNumbers(unlocks[number]);

  const unavailable = new Set(unavailableIssueNumbers);
  const pending = new Set(issueNumbers);
  const levelByIssue = {};
  let progressed = true;
  while (pending.size && progressed) {
    progressed = false;
    for (const number of [...pending].sort((left, right) => left - right)) {
      if (unavailable.has(number) || externalDependencies[number].length) continue;
      const blockers = dependencies[number] || [];
      if (!blockers.every((blocker) => Object.hasOwn(levelByIssue, blocker))) continue;
      levelByIssue[number] = blockers.length
        ? 1 + Math.max(...blockers.map((blocker) => levelByIssue[blocker]))
        : 0;
      pending.delete(number);
      progressed = true;
    }
  }

  const unresolvedIssueNumbers = [...pending].sort((left, right) => left - right);
  const cycles = detectDependencyCycles(dependencies);
  const cycleIssueNumbers = uniqueSortedNumbers(cycles.flat());
  const levelsByDepth = new Map();
  for (const [numberText, level] of Object.entries(levelByIssue)) {
    const number = Number(numberText);
    const values = levelsByDepth.get(level) || [];
    values.push(number);
    levelsByDepth.set(level, values);
  }
  const levels = [...levelsByDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, numbers]) => ({ level, issueNumbers: uniqueSortedNumbers(numbers) }));
  const levelValues = Object.values(levelByIssue);

  return {
    source: 'native-github-blocked-by',
    available: unavailableIssueNumbers.length === 0,
    issueNumbers,
    relationshipCount,
    unavailableIssueNumbers,
    dependencies,
    unlocks,
    resolvedDependencies,
    externalDependencies,
    levelByIssue,
    levels,
    maxLevel: levelValues.length ? Math.max(...levelValues) : null,
    unresolvedIssueNumbers,
    cycles,
    cycleIssueNumbers,
    counts: {
      readyNow: levelValues.filter((level) => level === 0).length,
      waitingOnOneLevel: levelValues.filter((level) => level === 1).length,
      waitingOnTwoLevels: levelValues.filter((level) => level === 2).length,
      waitingOnThreePlusLevels: levelValues.filter((level) => level >= 3).length,
      unresolved: unresolvedIssueNumbers.length,
    },
  };
}

export function buildManagerIssueFlow(items = []) {
  const byNumber = new Map(items.map((item) => [Number(item.issueNumber), item]));
  const automatic = new Set(items
    .filter((item) => ['active', 'next', 'eligible', 'blocked', 'skipped'].includes(String(item.statusId || '')))
    .map((item) => Number(item.issueNumber)));
  const included = new Set(automatic);
  let changed = true;
  while (changed) {
    changed = false;
    for (const number of [...included]) {
      for (const dependency of byNumber.get(number)?.dependencies || []) {
        const dependencyNumber = Number(dependency);
        if (byNumber.has(dependencyNumber) && !included.has(dependencyNumber)) {
          included.add(dependencyNumber);
          changed = true;
        }
      }
    }
  }

  const dependencies = {};
  const unlocks = Object.fromEntries([...included].map((number) => [number, []]));
  for (const number of included) {
    const internal = (byNumber.get(number)?.dependencies || [])
      .map(Number)
      .filter((dependency) => included.has(dependency));
    dependencies[number] = internal;
    for (const dependency of internal) unlocks[dependency].push(number);
  }
  for (const values of Object.values(unlocks)) values.sort((left, right) => left - right);

  const remaining = new Set(included);
  const resolved = new Set();
  const waves = [];
  while (remaining.size) {
    const wave = [...remaining]
      .filter((number) => (dependencies[number] || []).every((dependency) => resolved.has(dependency) || !remaining.has(dependency)))
      .sort((left, right) => left - right);
    if (!wave.length) break;
    waves.push(wave);
    for (const number of wave) {
      remaining.delete(number);
      resolved.add(number);
    }
  }

  return {
    automaticIssueNumbers: [...automatic].sort((left, right) => left - right),
    includedIssueNumbers: [...included].sort((left, right) => left - right),
    dependencies,
    unlocks,
    waves: waves.map((issueNumbers, index) => ({ wave: index + 1, issueNumbers })),
    unresolvedIssueNumbers: [...remaining].sort((left, right) => left - right),
  };
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
    const relationships = nativeRelationships(issue);
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
      ...relationships,
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

  const graph = buildManagerOpenIssueGraph(items);
  const enrichedItems = items.map((item) => ({
    ...item,
    dependencyLevel: Object.hasOwn(graph.levelByIssue, item.issueNumber) ? graph.levelByIssue[item.issueNumber] : null,
    directUnlocks: graph.unlocks[item.issueNumber] || [],
  }));

  return {
    mode: queue.mode,
    total: enrichedItems.length,
    eligible: enrichedItems.filter((item) => item.statusId === 'next' || item.statusId === 'eligible').length,
    blocked: enrichedItems.filter((item) => item.statusId === 'blocked').length,
    skipped: enrichedItems.filter((item) => item.statusId === 'skipped').length,
    active: enrichedItems.filter((item) => item.statusId === 'active').length,
    nextIssueNumber: orderedEligible[0] || null,
    flow: buildManagerIssueFlow(enrichedItems),
    graph,
    items: enrichedItems,
  };
}
