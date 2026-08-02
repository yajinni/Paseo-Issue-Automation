import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { heartbeat, recordEvent } from '../src/automation.mjs';
import { branchForAttempt, buildAttemptPrompt, skipIssue, unskipIssue } from '../src/attempts.mjs';
import { enhanceDashboardHtml } from '../src/operations-ui.mjs';
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

test('skipped issues persist and can be unskipped', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  skipIssue(root, 9);
  skipIssue(root, 9);
  assert.deepEqual(loadRuntime(root).skippedIssueNumbers, [9]);
  unskipIssue(root, 9);
  assert.deepEqual(loadRuntime(root).skippedIssueNumbers, []);
});

test('activity history records phase changes and evidence', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  saveConfig(root, { baseBranch: 'main', models: { orchestrator: 'x/a', coder: 'x/b', reviewer: 'x/b' } });
  saveRun(root, 4, { issueNumber: 4, phase: 'coding', events: [], activity: [] });
  heartbeat(root, 4, 'reviewing');
  recordEvent(root, 4, { event: 'review', result: 'CHANGES_REQUIRED', commit: 'abc', details: 'Fix edge case' });
  const state = loadRun(root, 4);
  assert.equal(state.activity[0].type, 'phase-changed');
  assert.equal(state.activity[1].type, 'review');
  assert.equal(state.activity[1].details, 'Fix edge case');
});

test('reviewer independence is fresh context, not a different model', () => {
  const prompt = buildAttemptPrompt(
    'owner/repo',
    { number: 1, url: 'https://github.com/owner/repo/issues/1' },
    'ai/issue-1-test',
    { baseBranch: 'main', maxReviewRounds: 3, models: { orchestrator: 'x/a', coder: 'x/same', reviewer: 'x/same' } },
  );
  assert.match(prompt, /may use the same model/i);
  assert.match(prompt, /must not share the Coder's chat history or working context/i);
  assert.match(prompt, /does not resume interrupted runs/i);
});

test('operations UI injects manual controls without replacing setup UI', () => {
  const source = '<style></style><section id="dashboard"><article class="card" style="margin-top:16px">\n    <h2>Configuration</h2></article></section><script>function render(){} function escapeHtml(v){return v;} function post(){}</script></body>';
  const enhanced = enhanceDashboardHtml(source);
  assert.match(enhanced, /Ready issues/);
  assert.match(enhanced, /Abandon attempt/);
  assert.match(enhanced, /Restart, keep old branch/);
  assert.match(enhanced, /<h2>Configuration<\/h2>/);
});
