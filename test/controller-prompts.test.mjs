import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_OUTPUT_SCHEMA,
  buildBaseUpdatePrompt,
  buildCoderPrompt,
  buildReviewerPrompt,
} from '../src/controller-prompts.mjs';

const config = {
  baseBranch: 'main',
  models: { orchestrator: 'unused/model', coder: 'opencode/coder', reviewer: 'opencode/reviewer' },
};
const issue = { number: 7, url: 'https://github.com/owner/repo/issues/7' };

test('coder prompt is controlled directly without an orchestrator model', () => {
  const prompt = buildCoderPrompt({ repository: 'owner/repo', issue, branch: 'ai/issue-7-test', config });
  assert.match(prompt, /You are the Coder/);
  assert.match(prompt, /Issue Execution Controller has already confirmed/);
  assert.match(prompt, /- Coder: opencode\/coder/);
  assert.match(prompt, /- Independent Reviewer: opencode\/reviewer/);
  assert.doesNotMatch(prompt, /unused\/model/);
  assert.match(prompt, /Do not rebase or force-push/);
});

test('review prompt requires fresh no-edit exact-commit review', () => {
  const prompt = buildReviewerPrompt({
    repository: 'owner/repo', issue, branch: 'ai/issue-7-test', commit: 'abc123', config,
  });
  assert.match(prompt, /fresh independent Reviewer/i);
  assert.match(prompt, /exact commit abc123/);
  assert.match(prompt, /Do not edit files/);
});

test('base update prompt requires merge rather than rebase', () => {
  const prompt = buildBaseUpdatePrompt({ issueNumber: 7, baseBranch: 'main', reason: 'base advanced' });
  assert.match(prompt, /merge origin\/main/);
  assert.match(prompt, /Do not rebase or force-push/);
});

test('review schema requires a boolean verdict and findings', () => {
  const schema = JSON.parse(REVIEW_OUTPUT_SCHEMA);
  assert.deepEqual(schema.required, ['approved', 'findings']);
  assert.equal(schema.properties.approved.type, 'boolean');
});
