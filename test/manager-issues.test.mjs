import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManagerIssueFlow,
  buildManagerOpenIssueGraph,
  managerIssuePlan,
} from '../src/manager-issues.mjs';

function issue(number, title = `Issue ${number}`, overrides = {}) {
  return {
    number,
    title,
    url: `https://github.test/issues/${number}`,
    labels: [],
    state: 'OPEN',
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

function relation(number, state = 'OPEN') {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.test/issues/${number}`,
    state,
    stateReason: state === 'CLOSED' ? 'COMPLETED' : '',
  };
}

test('manager issue plan shows every open issue while preserving scheduler order and blockers', () => {
  const issues = [issue(1), issue(2), issue(3), issue(4), issue(5)];
  let queueOptions = null;
  const plan = managerIssuePlan('/repo', { issueSelection: { mode: 'recommended-labels' } }, {
    jsonRunner: () => issues,
    runtimeLoader: () => ({ skippedIssueNumbers: [5] }),
    runLister: () => [{ issueNumber: 4, phase: 'coding', branch: 'ai/issue-4', startedAt: '2026-08-07T10:00:00Z' }],
    queueEvaluator: (_root, _config, options) => {
      queueOptions = options;
      return {
        mode: 'recommended-labels',
        eligible: [
          { issue: issues[0], dependency: { dependencies: [] } },
          { issue: issues[4], dependency: { dependencies: [] } },
        ],
        waiting: [{ issueNumber: 2, dependencies: [9], reasons: ['Blocked by open issue #9.'] }],
        rejected: [
          { issueNumber: 3, kind: 'not-ready', reason: 'Issue #3 is not labeled paseo:ready.' },
          { issueNumber: 4, kind: 'duplicate-claim', reason: 'Issue #4 already has an active automation attempt.' },
        ],
      };
    },
  });

  assert.equal(plan.total, 5);
  assert.equal(plan.nextIssueNumber, 1);
  assert.equal(plan.items.find((item) => item.issueNumber === 1).processingOrder, 1);
  assert.equal(plan.items.find((item) => item.issueNumber === 1).status, 'Next eligible');
  assert.equal(plan.items.find((item) => item.issueNumber === 2).status, 'Blocked by dependency');
  assert.deepEqual(plan.items.find((item) => item.issueNumber === 2).dependencies, [9]);
  assert.equal(plan.items.find((item) => item.issueNumber === 3).status, 'Not selected');
  assert.equal(plan.items.find((item) => item.issueNumber === 4).status, 'Coding');
  assert.equal(plan.items.find((item) => item.issueNumber === 5).status, 'Skipped');
  assert.equal(plan.eligible, 1);
  assert.equal(plan.blocked, 1);
  assert.equal(plan.active, 1);
  assert.equal(plan.skipped, 1);
  assert.ok(plan.flow);
  assert.ok(plan.graph);
  assert.deepEqual(plan.graph.issueNumbers, [1, 2, 3, 4, 5]);
  assert.equal(plan.graph.counts.readyNow, 5);
  assert.equal(plan.items.every((item) => item.relationshipDataAvailable === true), true);

  assert.equal(queueOptions.issues, issues);
  for (const callback of ['recordInvalid', 'restoreInvalid', 'recordWait', 'recordReady']) {
    assert.equal(typeof queueOptions[callback], 'function');
    assert.equal(queueOptions[callback](), null);
  }
});

test('manager issue plan returns eligible issues in lowest issue-number order', () => {
  const issues = [issue(12), issue(3), issue(8)];
  const plan = managerIssuePlan('/repo', { issueSelection: { mode: 'all-open' } }, {
    jsonRunner: () => issues,
    runtimeLoader: () => ({ skippedIssueNumbers: [] }),
    runLister: () => [],
    queueEvaluator: (_root, _config, options) => ({
      mode: 'all-open',
      eligible: [...options.issues]
        .sort((left, right) => left.number - right.number)
        .map((entry) => ({ issue: entry, dependency: { dependencies: [] } })),
      waiting: [],
      rejected: [],
    }),
  });

  assert.deepEqual(plan.items.map((item) => item.issueNumber), [3, 8, 12]);
  assert.deepEqual(plan.items.map((item) => item.processingOrder), [1, 2, 3]);
  assert.equal(plan.nextIssueNumber, 3);
});

test('historical unknown run does not override skipped and non-eligible state', () => {
  const issues = [issue(5)];
  const plan = managerIssuePlan('/repo', { issueSelection: { mode: 'all-open' } }, {
    jsonRunner: () => issues,
    runtimeLoader: () => ({ skippedIssueNumbers: [5] }),
    runLister: () => [{ issueNumber: 5, lifecycle: [{ type: 'operator-action', status: 'success' }] }],
    queueEvaluator: () => ({
      mode: 'all-open',
      eligible: [{ issue: issues[0], dependency: { dependencies: [] } }],
      waiting: [],
      rejected: [],
    }),
  });

  assert.equal(plan.items[0].status, 'Skipped');
  assert.equal(plan.items[0].statusId, 'skipped');
  assert.equal(plan.active, 0);
  assert.equal(plan.skipped, 1);
});

test('issue plan uses verified controller ownership instead of a persisted PID', () => {
  const issues = [issue(239)];
  const baseOptions = {
    jsonRunner: () => issues,
    runtimeLoader: () => ({ skippedIssueNumbers: [] }),
    runLister: () => [{
      issueNumber: 239,
      status: 'completed',
      phase: 'completed',
      completedAt: '2026-08-13T03:00:00.000Z',
      controllerPid: 54748,
    }],
    queueEvaluator: (_root, _config, options) => ({
      mode: 'all-open',
      eligible: [{ issue: options.issues[0], dependency: { dependencies: [] } }],
      waiting: [],
      rejected: [],
    }),
  };

  const stale = managerIssuePlan('/repo', { issueSelection: { mode: 'all-open' } }, {
    ...baseOptions,
    controllerLiveness: () => false,
  });
  assert.equal(stale.active, 0);
  assert.equal(stale.items[0].statusId, 'next');

  const live = managerIssuePlan('/repo', { issueSelection: { mode: 'all-open' } }, {
    ...baseOptions,
    controllerLiveness: () => true,
  });
  assert.equal(live.active, 1);
  assert.equal(live.items[0].statusId, 'active');
});

test('all-open graph keeps native relationships for unselected issues and computes exact levels', () => {
  const issues = [
    issue(1, 'Ready A', { blocking: [relation(3), relation(4)] }),
    issue(2, 'Ready B'),
    issue(3, 'Branch A', { blockedBy: [relation(1)], blocking: [relation(5)] }),
    issue(4, 'Branch B', { blockedBy: [relation(1)], blocking: [relation(5)] }),
    issue(5, 'Join', { blockedBy: [relation(3), relation(4)] }),
  ];
  const plan = managerIssuePlan('/repo', { issueSelection: { mode: 'recommended-labels' } }, {
    jsonRunner: () => issues,
    runtimeLoader: () => ({ skippedIssueNumbers: [] }),
    runLister: () => [],
    queueEvaluator: () => ({
      mode: 'recommended-labels',
      eligible: [],
      waiting: [],
      rejected: issues.map((entry) => ({ issueNumber: entry.number, kind: 'not-ready', reason: 'Not selected.' })),
    }),
  });

  assert.equal(plan.eligible, 0);
  assert.deepEqual(plan.graph.issueNumbers, [1, 2, 3, 4, 5]);
  assert.deepEqual(plan.graph.dependencies, {
    1: [],
    2: [],
    3: [1],
    4: [1],
    5: [3, 4],
  });
  assert.deepEqual(plan.graph.unlocks[1], [3, 4]);
  assert.deepEqual(plan.graph.unlocks[3], [5]);
  assert.deepEqual(plan.graph.levels, [
    { level: 0, issueNumbers: [1, 2] },
    { level: 1, issueNumbers: [3, 4] },
    { level: 2, issueNumbers: [5] },
  ]);
  assert.deepEqual(plan.graph.counts, {
    readyNow: 2,
    waitingOnOneLevel: 2,
    waitingOnTwoLevels: 1,
    waitingOnThreePlusLevels: 0,
    unresolved: 0,
  });
  assert.equal(plan.items.find((item) => item.issueNumber === 5).dependencyLevel, 2);
  assert.deepEqual(plan.items.find((item) => item.issueNumber === 1).directUnlocks, [3, 4]);
  assert.deepEqual(plan.items.find((item) => item.issueNumber === 5).nativeBlockedBy.map((entry) => entry.number), [3, 4]);
});

test('all-open graph ignores completed external blockers when assigning current open levels', () => {
  const graph = buildManagerOpenIssueGraph([
    {
      issueNumber: 10,
      relationshipDataAvailable: true,
      nativeBlockedBy: [relation(9, 'CLOSED')],
    },
    {
      issueNumber: 11,
      relationshipDataAvailable: true,
      nativeBlockedBy: [relation(10)],
    },
  ]);

  assert.deepEqual(graph.dependencies, { 10: [], 11: [10] });
  assert.deepEqual(graph.resolvedDependencies[10], [9]);
  assert.equal(graph.levelByIssue[10], 0);
  assert.equal(graph.levelByIssue[11], 1);
  assert.deepEqual(graph.unresolvedIssueNumbers, []);
});

test('all-open graph fails relationship availability closed and propagates unresolved depth', () => {
  const graph = buildManagerOpenIssueGraph([
    {
      issueNumber: 20,
      relationshipDataAvailable: false,
      nativeBlockedBy: [],
    },
    {
      issueNumber: 21,
      relationshipDataAvailable: true,
      nativeBlockedBy: [relation(20)],
    },
    {
      issueNumber: 22,
      relationshipDataAvailable: true,
      nativeBlockedBy: [],
    },
  ]);

  assert.equal(graph.available, false);
  assert.deepEqual(graph.unavailableIssueNumbers, [20]);
  assert.deepEqual(graph.levelByIssue, { 22: 0 });
  assert.deepEqual(graph.unresolvedIssueNumbers, [20, 21]);
  assert.equal(graph.counts.readyNow, 1);
  assert.equal(graph.counts.unresolved, 2);
});

test('all-open graph keeps a missing open blocker unresolved instead of pretending it is complete', () => {
  const graph = buildManagerOpenIssueGraph([
    {
      issueNumber: 30,
      relationshipDataAvailable: true,
      nativeBlockedBy: [relation(999, 'OPEN')],
    },
    {
      issueNumber: 31,
      relationshipDataAvailable: true,
      nativeBlockedBy: [relation(30)],
    },
  ]);

  assert.equal(graph.available, true);
  assert.deepEqual(graph.externalDependencies[30], [999]);
  assert.deepEqual(graph.unresolvedIssueNumbers, [30, 31]);
  assert.deepEqual(graph.levels, []);
});

test('all-open graph reports cycles instead of inventing a dependency level', () => {
  const graph = buildManagerOpenIssueGraph([
    { issueNumber: 40, relationshipDataAvailable: true, nativeBlockedBy: [relation(41)] },
    { issueNumber: 41, relationshipDataAvailable: true, nativeBlockedBy: [relation(40)] },
    { issueNumber: 42, relationshipDataAvailable: true, nativeBlockedBy: [] },
  ]);

  assert.deepEqual(graph.levels, [{ level: 0, issueNumbers: [42] }]);
  assert.deepEqual(graph.unresolvedIssueNumbers, [40, 41]);
  assert.deepEqual(graph.cycleIssueNumbers, [40, 41]);
  assert.equal(graph.cycles.length, 1);
});

test('dependency flow groups independent issues into parallel waves and records unlocks', () => {
  const flow = buildManagerIssueFlow([
    { issueNumber: 1, statusId: 'next', dependencies: [] },
    { issueNumber: 2, statusId: 'eligible', dependencies: [] },
    { issueNumber: 3, statusId: 'blocked', dependencies: [1] },
    { issueNumber: 4, statusId: 'blocked', dependencies: [1] },
    { issueNumber: 5, statusId: 'blocked', dependencies: [3, 4] },
  ]);

  assert.deepEqual(flow.waves, [
    { wave: 1, issueNumbers: [1, 2] },
    { wave: 2, issueNumbers: [3, 4] },
    { wave: 3, issueNumbers: [5] },
  ]);
  assert.deepEqual(flow.unlocks[1], [3, 4]);
  assert.deepEqual(flow.unlocks[3], [5]);
  assert.deepEqual(flow.unlocks[4], [5]);
  assert.deepEqual(flow.unresolvedIssueNumbers, []);
});

test('dependency flow includes an unselected open issue when automatic work depends on it', () => {
  const flow = buildManagerIssueFlow([
    { issueNumber: 10, statusId: 'not-ready', dependencies: [] },
    { issueNumber: 11, statusId: 'blocked', dependencies: [10] },
    { issueNumber: 12, statusId: 'not-ready', dependencies: [] },
  ]);

  assert.deepEqual(flow.automaticIssueNumbers, [11]);
  assert.deepEqual(flow.includedIssueNumbers, [10, 11]);
  assert.deepEqual(flow.waves, [
    { wave: 1, issueNumbers: [10] },
    { wave: 2, issueNumbers: [11] },
  ]);
});

test('dependency flow reports cycles instead of inventing a runnable order', () => {
  const flow = buildManagerIssueFlow([
    { issueNumber: 21, statusId: 'blocked', dependencies: [22] },
    { issueNumber: 22, statusId: 'blocked', dependencies: [21] },
  ]);
  assert.deepEqual(flow.waves, []);
  assert.deepEqual(flow.unresolvedIssueNumbers, [21, 22]);
});
