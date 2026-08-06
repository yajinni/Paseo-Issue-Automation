import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchAvailableIssues } from '../src/dispatch-batch.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-claim-limit-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('maxClaims limits one manager scheduling turn without changing repository capacity', (t) => {
  const root = repository(t);
  let active = 0;
  let issueNumber = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 5 }),
    activeCount: () => active,
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      active += 1;
      issueNumber += 1;
      return { claimed: true, issueNumber, branch: `ai/issue-${issueNumber}` };
    },
    maxClaims: 1,
  });
  assert.equal(result.claimed, true);
  assert.equal(result.attempts.length, 1);
  assert.equal(issueNumber, 1);
});

test('default dispatch still fills all repository slots', (t) => {
  const root = repository(t);
  let active = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 3 }),
    activeCount: () => active,
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      active += 1;
      return { claimed: true, issueNumber: active, branch: `ai/issue-${active}` };
    },
  });
  assert.equal(result.attempts.length, 3);
});

test('invalid claim limits are rejected before dispatch', (t) => {
  const root = repository(t);
  assert.throws(
    () => dispatchAvailableIssues(root, { maxClaims: 0 }),
    /positive integer/,
  );
});
