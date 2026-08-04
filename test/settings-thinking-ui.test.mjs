import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { MODEL_THINKING_UI_SCRIPT } from '../src/model-thinking-ui-script.mjs';
import { PR_REVIEW_SETTINGS_TOGGLE_SCRIPT } from '../src/pr-review-settings-toggle-script.mjs';
import { paseoRunArgsWithThinking } from '../src/process.mjs';
import { validateConfig } from '../src/state.mjs';
import { dashboardHtml } from '../src/ui.mjs';

function baseConfig(models = {}) {
  return {
    baseBranch: 'main',
    pollIntervalSeconds: 120,
    maxActive: 1,
    maxReviewRounds: 4,
    models: {
      coder: 'opencode/coder-model',
      reviewer: 'opencode/reviewer-model',
      ...models,
    },
  };
}

test('settings expose an opt-in automatic ChatGPT PR review toggle', () => {
  const html = dashboardHtml();
  assert.match(html, /Automatic PR Review With ChatGPT/);
  assert.match(html, /id=\"automatic-pr-review-enabled\"/);
  assert.match(html, /id=\"pr-review-settings-grid\" hidden/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /projectSettingsCard/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /browserSettingsCard/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /master\.value = String\(enabled\)/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /browser\.value = String\(enabled\)/);
});

test('dashboard cleanup renames Issues Map and removes redundant actions', () => {
  const html = dashboardHtml();
  assert.match(html, />Issues Map<\/button>/);
  assert.doesNotMatch(html, />Dependencies<\/button>/);
  assert.doesNotMatch(html, /id=\"reconcile-button\"/);
  assert.doesNotMatch(html, />Finish setup<\/button>/);
});

test('model thinking controls are rendered for coder and reviewer', () => {
  const html = dashboardHtml();
  assert.match(html, /coderThinking/);
  assert.match(html, /reviewerThinking/);
  assert.match(MODEL_THINKING_UI_SCRIPT, /Coder thinking level/);
  assert.match(MODEL_THINKING_UI_SCRIPT, /Independent Reviewer thinking level/);
  assert.match(MODEL_THINKING_UI_SCRIPT, /thinkingOptionIds/);
  assert.match(MODEL_THINKING_UI_SCRIPT, /defaultThinkingOptionId/);
});

test('thinking levels persist in validated project configuration', () => {
  const config = validateConfig(baseConfig({ coderThinking: 'high', reviewerThinking: 'xhigh' }));
  assert.equal(config.models.coderThinking, 'high');
  assert.equal(config.models.reviewerThinking, 'xhigh');
  assert.throws(
    () => validateConfig(baseConfig({ coderThinking: 'not valid' })),
    /Coder thinking level must be a valid Paseo thinking option ID/,
  );
});

test('configured thinking levels are applied to each Paseo agent role', () => {
  const config = { models: { coderThinking: 'high', reviewerThinking: 'xhigh' } };
  const coder = paseoRunArgsWithThinking([
    'run', '--provider', 'opencode/coder-model', '--title', 'Issue #12 Coder (attempt 1)', 'prompt',
  ], { config });
  assert.deepEqual(coder.slice(0, 7), [
    'run', '--provider', 'opencode/coder-model', '--thinking', 'high', '--title', 'Issue #12 Coder (attempt 1)',
  ]);

  const reviewer = paseoRunArgsWithThinking([
    'run', '--provider', 'opencode/reviewer-model', '--title', 'Issue #12 Reviewer', 'prompt',
  ], { config });
  assert.deepEqual(reviewer.slice(0, 7), [
    'run', '--provider', 'opencode/reviewer-model', '--thinking', 'xhigh', '--title', 'Issue #12 Reviewer',
  ]);

  const fixes = paseoRunArgsWithThinking([
    'run', '--provider', 'opencode/coder-model', '--title', 'PR #44 fixes (round 2)', 'prompt',
  ], { config });
  assert.equal(fixes[4], 'high');

  const explicit = paseoRunArgsWithThinking([
    'run', '--provider', 'opencode/coder-model', '--thinking', 'low', '--title', 'Issue #12 Coder', 'prompt',
  ], { config });
  assert.equal(explicit.filter((value) => value === '--thinking').length, 1);
  assert.equal(explicit[4], 'low');
});

test('all generated dashboard scripts compile', () => {
  const html = dashboardHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 10);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script), `inline script ${index + 1} should compile`);
  });
});
