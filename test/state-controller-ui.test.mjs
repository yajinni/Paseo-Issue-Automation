import assert from 'node:assert/strict';
import test from 'node:test';
import { applyIssueExecutionControllerUi } from '../src/controller-ui.mjs';
import { validateConfig } from '../src/state.mjs';

test('configuration migrates to deterministic controller and aliases the legacy field', () => {
  const config = validateConfig({
    baseBranch: 'main',
    models: { coder: 'opencode/coder', reviewer: 'opencode/reviewer' },
  });
  assert.equal(config.controller.type, 'deterministic');
  assert.equal(config.models.orchestrator, 'opencode/coder');
  assert.equal(config.models.coder, 'opencode/coder');
});

test('dashboard hides the obsolete orchestrator input', () => {
  const html = '<h2>Controller</h2><p>The base branch creates issue branches and is also their PR target. Task-specific checks come from each issue.</p><label>Orchestrator model<input id="orchestrator" placeholder="provider/model"></label>';
  const result = applyIssueExecutionControllerUi(html);
  assert.match(result, /Issue Execution Controller/);
  assert.match(result, /id="orchestrator" type="hidden"/);
  assert.doesNotMatch(result, /Orchestrator model/);
});
