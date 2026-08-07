import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagerIssueFlow, managerIssuePlan } from '../src/manager-issues.mjs';

function issue(number, title = `Issue ${number}`) {
  return { number, title, url: `https://github.test/issues/${number}`, labels: [], state: 'OPEN', blockedBy: [], blocking: [] };
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
