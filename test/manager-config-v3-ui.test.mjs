import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerHtml } from '../src/manager-maintenance-ui.mjs';
import { managerRepositoryStatus } from '../src/manager-status.mjs';
import { loadConfig, saveConfig } from '../src/state.mjs';

function createRepository(parent, name) {
  const root = path.join(parent, name);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:yajinni/${name}.git`], { cwd: root });
  return root;
}

test('manager status exposes setup schema v3 configuration for post-setup editing', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-manager-config-v3-'));
  const root = createRepository(parent, 'ConfigParity');
  const current = loadConfig(root);
  saveConfig(root, {
    ...current,
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 90,
    maxActive: 20,
    codingHarness: 'opencode',
    issueSelection: {
      mode: 'all-open',
      excludedLabels: ['manual-only'],
      temporaryFailureRetries: 7,
    },
    review: {
      workflow: 'quick-web-chatgpt',
      quickMaxRounds: 8,
      fullMaxRounds: 9,
      autoMergeApproved: true,
    },
    models: {
      ...current.models,
      coder: 'openai/gpt-5.6',
      coderThinking: 'high',
      reviewer: 'openai/gpt-5.6',
      reviewerThinking: 'medium',
    },
  });

  const status = managerRepositoryStatus({
    id: 'config-parity',
    path: root,
    repository: 'yajinni/ConfigParity',
  });

  assert.equal(status.automation.maxActive, 20);
  assert.equal(status.configuration.codingHarness, 'opencode');
  assert.deepEqual(status.configuration.issueSelection, {
    mode: 'all-open',
    excludedLabels: ['manual-only'],
    temporaryFailureRetries: 7,
  });
  assert.deepEqual(status.configuration.review, {
    workflow: 'quick-web-chatgpt',
    quickMaxRounds: 8,
    fullMaxRounds: 9,
    autoMergeApproved: true,
  });
  assert.equal(status.models.coderThinking, 'high');
  assert.equal(status.models.reviewerThinking, 'medium');
});

test('standalone manager configuration UI matches setup schema v3 controls and limits', () => {
  const html = managerHtml();
  assert.match(html, /Provider\/Coding Harness/);
  assert.match(html, /id="max-active" type="number" min="1" max="20"/);
  assert.match(html, /id="issue-selection-mode"/);
  assert.match(html, /id="temporary-failure-retries" type="number" min="0" max="20"/);
  assert.match(html, /id="review-workflow"/);
  assert.match(html, /Quick → Manual/);
  assert.match(html, /Quick → Web ChatGPT/);
  assert.match(html, /Full review immediately/);
  assert.match(html, /id="quick-review-rounds" type="number" min="1" max="20"/);
  assert.match(html, /id="full-review-rounds" type="number" min="1" max="20"/);
  assert.match(html, /id="auto-merge-approved" type="checkbox"/);
  assert.match(html, /Automatic merge is unavailable for Quick → Manual/);
  assert.match(html, /coderThinking:/);
  assert.match(html, /reviewerThinking:/);
  assert.doesNotMatch(html, /id="max-review-rounds"/);
});
