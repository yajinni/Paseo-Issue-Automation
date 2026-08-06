import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchAvailableIssues } from '../src/dispatch-batch.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-dispatch-batch-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('one polling cycle fills all currently available execution slots', (t) => {
  const root = repository(t);
  const queue = [
    { claimed: true, issueNumber: 10, branch: 'ai/issue-10-a' },
    { claimed: true, issueNumber: 11, branch: 'ai/issue-11-b' },
    { claimed: false, reason: 'No eligible ready issue found.' },
  ];
  let active = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 3 }),
    activeCount: () => active,
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      const next = queue.shift();
      if (next?.claimed) active += 1;
      return next;
    },
  });
  assert.equal(result.claimed, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.issueNumber), [10, 11]);
  assert.equal(result.dispatches.length, 3);
});

test('batch dispatch never exceeds the configured maximum', (t) => {
  const root = repository(t);
  let calls = 0;
  let active = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 2 }),
    activeCount: () => active,
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      active += 1;
      return { claimed: true, issueNumber: ++calls, branch: `ai/issue-${calls}` };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts.length, 2);
});


test('pending launch retries run before capacity prevents new dispatch', (t) => {
  const root = repository(t);
  let issueDispatches = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 1 }),
    activeCount: () => 1,
    resumeLaunches: () => ({
      claimed: true,
      haltDispatch: true,
      reason: 'retry scheduled in existing workspace',
      attempts: [{ claimed: true, issueNumber: 274, branch: 'ai/issue-274', attempt: 2, pending: true }],
      results: [{ claimed: true, issueNumber: 274, pending: true }],
    }),
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      issueDispatches += 1;
      return { claimed: false };
    },
  });
  assert.equal(result.claimed, true);
  assert.equal(result.issueNumber, 274);
  assert.equal(result.haltDispatch, true);
  assert.equal(issueDispatches, 0);
});

test('terminal launch failure halts the cycle instead of claiming another issue', (t) => {
  const root = repository(t);
  let issueDispatches = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 1 }),
    activeCount: () => 0,
    resumeLaunches: () => ({
      claimed: false,
      haltDispatch: true,
      reason: 'agent failed after bounded retries',
      attempts: [],
      results: [{ claimed: false, failed: true, issueNumber: 274 }],
    }),
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      issueDispatches += 1;
      return { claimed: true, issueNumber: 275 };
    },
  });
  assert.equal(result.claimed, false);
  assert.equal(result.haltDispatch, true);
  assert.equal(issueDispatches, 0);
});
