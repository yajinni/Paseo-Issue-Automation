import assert from 'node:assert/strict';
import test from 'node:test';
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
