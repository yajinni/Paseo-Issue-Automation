import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { heartbeat, recordEvent } from '../src/automation.mjs';
import { branchForAttempt, buildAttemptPrompt, skipIssue, unskipIssue } from '../src/attempts.mjs';
import { loadRuntime, loadRun, saveConfig, saveRun } from '../src/state.mjs';

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-attempts-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('attempt branches are deterministic and numbered', () => {
  assert.equal(branchForAttempt(12, 'Fix login redirect', 1), 'ai/issue-12-fix-login-redirect');
  assert.equal(branchForAttempt(12, 'Fix login redirect', 3), 'ai/issue-12-fix-login-redirect-attempt-3');
});

test('long issue titles produce valid first and retry attempt branches', () => {
  const title = 'Make Overview Start/Stop controls authoritative for Issue Claiming and PR Reviews';
  const first = branchForAttempt(295, title, 1);
  const retry = branchForAttempt(295, title, 2);
  assert.equal(first, 'ai/issue-295-make-overview-start-stop-controls-authoritative');
  assert.equal(retry, 'ai/issue-295-make-overview-start-stop-controls-authoritative-attempt-2');
  assert.doesNotMatch(first, /--/);
  assert.doesNotMatch(retry, /--/);
  assert.doesNotMatch(first, /-$/);
});

test('skipped issues persist and can be unskipped', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  skipIssue(root, 9);
  skipIssue(root, 9);
  assert.deepEqual(loadRuntime(root).skippedIssueNumbers, [9]);
  unskipIssue(root, 9);
  assert.deepEqual(loadRuntime(root).skippedIssueNumbers, []);
});

test('attempt state records heartbeat phase and review evidence', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  saveConfig(root, { baseBranch: 'main', models: { orchestrator: 'x/a', coder: 'x/b', reviewer: 'x/b' } });
  saveRun(root, 4, { issueNumber: 4, phase: 'coding', events: [], activity: [] });
  heartbeat(root, 4, 'reviewing');
  recordEvent(root, 4, { event: 'review', result: 'CHANGES_REQUIRED', commit: 'abc', details: 'Fix edge case' });
  const state = loadRun(root, 4);
  assert.equal(state.phase, 'reviewing');
  assert.ok(state.heartbeatAt);
  assert.equal(state.events[0].event, 'review');
  assert.equal(state.events[0].details, 'Fix edge case');
});

test('reviewer independence is fresh context, not a different model', () => {
  const prompt = buildAttemptPrompt(
    'owner/repo',
    { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    'ai/issue-1-test',
    { baseBranch: 'main', maxReviewRounds: 3, models: { orchestrator: 'x/a', coder: 'x/same', reviewer: 'x/same' } },
  );
  assert.match(prompt, /- Coder: x\/same/);
  assert.match(prompt, /- Independent Reviewer: x\/same/);
  assert.match(prompt, /fresh independent Reviewer session with no shared Coder chat history or working context/i);
  assert.match(prompt, /cannot be resumed or recovered/i);
});
