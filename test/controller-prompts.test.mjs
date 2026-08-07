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

test('coder completion leaves validation bookkeeping to the controller', () => {
  const prompt = buildCoderPrompt({ repository: 'owner/repo', issue, branch: 'ai/issue-7-test', config });
  assert.doesNotMatch(prompt, /npx --no-install/);
  assert.doesNotMatch(prompt, /record --issue 7 --event validation-summary/);
  assert.match(prompt, /Controller owns the internal validation-summary bookkeeping/i);
  assert.match(prompt, /Do not call Paseo's hooks command/i);
  assert.match(prompt, /Commit all intended changes, push the exact branch head/i);
  assert.match(prompt, /Do not finish with uncommitted worktree changes/i);
  assert.match(prompt, /block --issue 7 --reason/);
});

test('completion recovery repairs only the mechanical handoff and forbids Paseo hooks', () => {
  const prompt = buildCompletionRecoveryPrompt({
    issueNumber: 7,
    branch: 'ai/issue-7-test',
    baseBranch: 'main',
    reason: 'Coder finished without an open pull request.',
  });
  assert.match(prompt, /preserve completed work/i);
  assert.match(prompt, /open draft pull request from ai\/issue-7-test into main/i);
  assert.match(prompt, /Run or rerun every validation\/check required by the issue/i);
  assert.match(prompt, /worktree is clean/i);
  assert.match(prompt, /PR head exactly matches local HEAD/i);
  assert.match(prompt, /Do NOT call `paseo hooks`/i);
  assert.doesNotMatch(prompt, /validation-summary --result PASS --commit/);
});

test('repair and base-update prompts require clean exact-head PRs without coder bookkeeping', () => {
  const repair = buildRepairPrompt({ issueNumber: 7, findings: 'Fix the test.' });
  const update = buildBaseUpdatePrompt({ issueNumber: 7, baseBranch: 'main', reason: 'base advanced' });
  for (const prompt of [repair, update]) {
    assert.match(prompt, /controller owns validation-summary bookkeeping/i);
    assert.match(prompt, /do not call Paseo hooks/i);
    assert.match(prompt, /worktree clean|worktree is clean/i);
    assert.match(prompt, /PR head/i);
    assert.doesNotMatch(prompt, /record --issue 7 --event validation-summary/);
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
