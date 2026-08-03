import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionModel, summarizePrChecks } from '../src/dashboard-status.mjs';

test('PR check summary distinguishes passed, pending, and failed checks', () => {
  assert.equal(summarizePrChecks([{ name: 'test', conclusion: 'SUCCESS' }]).state, 'passed');
  assert.equal(summarizePrChecks([{ name: 'test', status: 'IN_PROGRESS' }]).state, 'pending');
  const failed = summarizePrChecks([{ name: 'test', conclusion: 'FAILURE' }]);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failed, 1);
});

test('execution model exposes waves, shared capacity, human-review inbox, and recent activity', () => {
  const issues = [
    { number: 10, title: 'Foundation', dependencies: [] },
    { number: 11, title: 'API', dependencies: [10] },
    { number: 12, title: 'UI', dependencies: [10] },
    { number: 13, title: 'Integration', dependencies: [11, 12] },
  ];
  const attempts = [
    { issueNumber: 10, issueTitle: 'Foundation', status: 'agent-running', activity: [{ type: 'coding', at: '2026-08-03T12:00:00Z' }], events: [] },
    { issueNumber: 13, issueTitle: 'Integration', status: 'human-review', activity: [], events: [{ event: 'review', result: 'APPROVED', at: '2026-08-03T12:01:00Z' }] },
  ];
  const result = buildExecutionModel({
    issues,
    attempts,
    activeFixCount: 1,
    config: { maxActive: 3, pollIntervalSeconds: 120 },
    runtime: { claimsEnabled: true, lastDispatchAt: '2026-08-03T12:00:00Z', lastDispatchResult: { claimed: true } },
  });
  assert.deepEqual(result.waves.map((wave) => wave.issues.map((issue) => issue.number)), [[10], [11, 12], [13]]);
  assert.deepEqual(result.capacity, {
    active: 2,
    issueActive: 1,
    fixActive: 1,
    maximum: 3,
    available: 1,
  });
  assert.equal(result.humanReview[0].issueNumber, 13);
  assert.equal(result.recentActivity[0].type, 'review');
  assert.equal(result.lastDispatchResult.claimed, true);
});
