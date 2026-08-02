import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrchestratorPrompt, parseDependencies, sectionContent, slugify, validateIssueBody } from '../src/automation.mjs';
import { validateConfig, WORKSPACE_TITLE } from '../src/state.mjs';

test('workspace title is stable', () => {
  assert.equal(WORKSPACE_TITLE, 'Issue Coding Automation');
});

test('configuration uses one base branch and validates model separation', () => {
  const config = validateConfig({
    baseBranch: 'main',
    models: { orchestrator: 'opencode/model-a', coder: 'opencode/model-b', reviewer: 'codex/model-c' },
  });
  assert.equal(config.baseBranch, 'main');
  assert.throws(() => validateConfig({
    baseBranch: 'main',
    models: { coder: 'opencode/same', reviewer: 'opencode/same' },
  }), /must be different/);
});

test('issue validation requires issue-owned checks', () => {
  const body = `## Objective
Ship it
## Required behavior
Change it
## Acceptance criteria
- [ ] Works
## Validation and checks
- [ ] Run focused test
## Stop conditions
Block on ambiguity`;
  assert.equal(validateIssueBody(body).ok, true);
  assert.equal(sectionContent(body, 'Validation and checks'), '- [ ] Run focused test');
  assert.equal(validateIssueBody(body.replace('- [ ] Run focused test', '')).ok, false);
});

test('dependencies and branch slug are deterministic', () => {
  assert.deepEqual(parseDependencies('Blocked by #12\nDepends on #13\nBlocked by #12'), [12, 13]);
  assert.equal(slugify('Fix login / redirect!'), 'fix-login-redirect');
});

test('orchestrator prompt is repository independent', () => {
  const prompt = buildOrchestratorPrompt({
    repository: 'owner/repo',
    issue: { number: 7, url: 'https://github.com/owner/repo/issues/7' },
    branch: 'ai/issue-7-test',
    config: {
      baseBranch: 'main',
      maxReviewRounds: 4,
      requireDifferentCoderReviewer: true,
      models: { orchestrator: 'opencode/a', coder: 'opencode/b', reviewer: 'codex/c' },
    },
  });
  assert.doesNotMatch(prompt, /AGENTS\.md|CodeGraph|rewrite\/openspec|npm run check/);
  assert.match(prompt, /issue author owns selecting those checks/i);
  assert.match(prompt, /Do not assume a workflow name/);
});
