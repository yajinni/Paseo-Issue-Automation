import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { agentRunArgs } from '../src/launch-retry.mjs';

test('coder agent arguments apply a configured Paseo thinking option', () => {
  const args = agentRunArgs({
    provider: 'opencode/openai/gpt-5.6',
    thinking: 'high',
    title: 'Issue #42 Coder (attempt 1)',
    workspaceId: 'workspace-42',
    prompt: 'Implement issue 42.',
  });

  assert.deepEqual(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 4), [
    '--provider', 'opencode/openai/gpt-5.6', '--thinking', 'high',
  ]);
  assert.equal(args.at(-1), 'Implement issue 42.');
});

test('agent arguments omit --thinking when no thinking option is configured', () => {
  const args = agentRunArgs({
    provider: 'opencode/openai/gpt-5.6',
    thinking: '',
    title: 'Issue #42 Coder (attempt 1)',
    workspaceId: 'workspace-42',
    prompt: 'Implement issue 42.',
  });

  assert.equal(args.includes('--thinking'), false);
});

test('saved coder and reviewer thinking selections are wired into their production run commands', () => {
  const attempts = readFileSync(new URL('../src/attempts.mjs', import.meta.url), 'utf8');
  const stagedReview = readFileSync(new URL('../src/controller-review-workflow.mjs', import.meta.url), 'utf8');

  assert.match(attempts, /thinking:\s*config\.models\.coderThinking/);
  assert.match(stagedReview, /config\.models\.reviewerThinking\s*\?\s*\['--thinking',\s*config\.models\.reviewerThinking\]/);
});
