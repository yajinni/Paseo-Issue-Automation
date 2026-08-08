import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttemptPrompt } from '../src/attempts.mjs';
import { agentRunArgs, normalizeAttemptPrompt } from '../src/launch-retry.mjs';

const obsolete = 'This attempt cannot be resumed or recovered. If interrupted, it will be abandoned and restarted fresh.';

test('coder launch replaces the obsolete no-recovery instruction with controller-authorized recover-first policy', () => {
  const config = {
    baseBranch: 'main',
    models: { coder: 'fixture/coder', reviewer: 'fixture/reviewer' },
  };
  const issue = {
    number: 808,
    url: 'https://example.invalid/owner/repo/issues/808',
  };
  const branch = 'ai/issue-808-recover-first';
  const rawPrompt = buildAttemptPrompt('owner/repo', issue, branch, config);
  assert.match(rawPrompt, /cannot be resumed or recovered/i, 'fixture must exercise the legacy caller text');

  const args = agentRunArgs({
    provider: 'fixture/coder',
    thinking: 'medium',
    title: 'Issue #808 Coder',
    workspaceId: 'workspace-808',
    prompt: rawPrompt,
  });
  const runtimePrompt = args.at(-1);

  assert.doesNotMatch(runtimePrompt, /cannot be resumed or recovered/i);
  assert.doesNotMatch(runtimePrompt, /abandoned and restarted fresh/i);
  assert.match(runtimePrompt, /controller explicitly requests recover-first continuation/i);
  assert.match(runtimePrompt, /existing workspace, branch, and coder/i);
  assert.match(runtimePrompt, /Do not create an ad-hoc replacement workspace, branch, or duplicate coder/i);
});

test('prompt normalization leaves unrelated prompts unchanged', () => {
  const prompt = 'Implement the issue and follow the controller lifecycle instructions.';
  assert.equal(normalizeAttemptPrompt(prompt), prompt);
  assert.equal(normalizeAttemptPrompt(obsolete).includes('recover-first continuation'), true);
});
