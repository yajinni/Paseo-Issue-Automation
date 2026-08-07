import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_OUTPUT_SCHEMA,
  buildBaseUpdatePrompt,
  buildCoderPrompt,
  buildCompletionRecoveryPrompt,
  buildRepairPrompt,
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

test('coder completion uses the installed controller CLI and requires a successful handoff', () => {
  const prompt = buildCoderPrompt({ repository: 'owner/repo', issue, branch: 'ai/issue-7-test', config });
  assert.doesNotMatch(prompt, /npx --no-install/);
  assert.match(prompt, /node ["'][^\n]*paseo-issue-automation\.mjs["'] record --issue 7 --event validation-summary --result PASS/);
  assert.match(prompt, /Do not finish the coding session until this record command exits successfully/);
  assert.match(prompt, /block --issue 7 --reason/);
});

test('completion recovery preserves work and repairs PR plus exact-head validation evidence', () => {
  const prompt = buildCompletionRecoveryPrompt({
    issueNumber: 7,
    branch: 'ai/issue-7-test',
    baseBranch: 'main',
    reason: 'Coder finished without recording a passing validation-summary event.',
  });
  assert.match(prompt, /Preserve completed work/);
  assert.match(prompt, /open draft pull request from ai\/issue-7-test into main/);
  assert.match(prompt, /Run or rerun every validation\/check required by the issue/);
  assert.match(prompt, /validation-summary --result PASS --commit <exact-current-head-sha>/);
  assert.match(prompt, /Do not reuse stale validation evidence/);
});

test('repair and base-update prompts require fresh recorded exact-head validation', () => {
  const repair = buildRepairPrompt({ issueNumber: 7, findings: 'Fix the test.' });
  const update = buildBaseUpdatePrompt({ issueNumber: 7, baseBranch: 'main', reason: 'base advanced' });
  for (const prompt of [repair, update]) {
    assert.doesNotMatch(prompt, /npx --no-install/);
    assert.match(prompt, /validation-summary --result PASS --commit <sha>/);
    assert.match(prompt, /do not finish until the record command succeeds/i);
  }
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
