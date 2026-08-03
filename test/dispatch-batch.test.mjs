import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchAvailableIssues } from '../src/dispatch-batch.mjs';

test('one polling cycle fills all currently available execution slots', () => {
  const queue = [
    { claimed: true, issueNumber: 10, branch: 'ai/issue-10-a' },
    { claimed: true, issueNumber: 11, branch: 'ai/issue-11-b' },
    { claimed: false, reason: 'Maximum active issue count reached.' },
  ];
  const result = dispatchAvailableIssues('/repo', {
    configLoader: () => ({ maxActive: 3 }),
    dispatchOne: () => queue.shift(),
  });
  assert.equal(result.claimed, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.issueNumber), [10, 11]);
  assert.equal(result.dispatches.length, 3);
});

test('batch dispatch never exceeds the configured maximum', () => {
  let calls = 0;
  const result = dispatchAvailableIssues('/repo', {
    configLoader: () => ({ maxActive: 2 }),
    dispatchOne: () => ({ claimed: true, issueNumber: ++calls, branch: `ai/issue-${calls}` }),
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts.length, 2);
});
