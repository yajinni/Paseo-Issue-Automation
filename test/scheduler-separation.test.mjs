import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchAvailableIssues } from '../src/dispatch-batch.mjs';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-coding-slots-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('fix jobs and new issues share coding slots while open PR reviews consume none', (t) => {
  const root = repo(t);
  let active = 0;
  let fixes = 1;
  let issues = 5;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 4 }),
    activeCount: () => active,
    dispatchFix: () => {
      if (!fixes) return { claimed: false };
      fixes -= 1; active += 1;
      return { claimed: true, jobId: 'fix-1', pullRequestNumber: 45, issueNumber: 101 };
    },
    dispatchIssue: () => {
      if (!issues) return { claimed: false };
      const issueNumber = 200 + issues; issues -= 1; active += 1;
      return { claimed: true, issueNumber, branch: `ai/issue-${issueNumber}` };
    },
  });
  assert.equal(result.attempts.length, 4);
  assert.deepEqual(result.attempts.map((attempt) => attempt.type), ['fix', 'issue', 'issue', 'issue']);
  assert.equal(active, 4);
});

test('an active browser review does not reduce coding capacity', (t) => {
  const root = repo(t);
  let activeCoding = 0;
  const result = dispatchAvailableIssues(root, {
    configLoader: () => ({ maxActive: 2 }),
    activeCount: () => activeCoding,
    dispatchFix: () => ({ claimed: false }),
    dispatchIssue: () => {
      activeCoding += 1;
      return { claimed: true, issueNumber: 10 + activeCoding, branch: `ai/issue-${10 + activeCoding}` };
    },
  });
  assert.equal(result.attempts.length, 2);
});
