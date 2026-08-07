import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  confirmedSetupPullRequestReady,
  getSetupPullRequestConfirmation,
  installConfirmedLifecycleLabels,
  requestSetupPullRequestAutoMerge,
  validateSetupPullRequestConfirmation,
} from '../../src/setup-wizard/setup-pr-service.mjs';
import { saveSetupPage, startSetupSession } from '../../src/setup-wizard/store.mjs';
import { saveConfig } from '../../src/state.mjs';

function setup(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'setup-pr-confirmation-'));
  const checkoutPath = mkdtempSync(path.join(os.tmpdir(), 'setup-pr-checkout-'));
  t.after(() => {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(checkoutPath, { recursive: true, force: true });
  });
  startSetupSession({ rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'release',
    selections: { host: 'github.com', account: 'octo', repository: 'octo/app', baseBranch: 'release' },
  }, { rootDir });
  saveSetupPage('checkout', {
    selections: { checkoutPath, checkoutManaged: true },
  }, { rootDir });
  saveConfig(checkoutPath, { setupComplete: false, baseBranch: 'release', maxActive: 1, models: {}, workspace: {} });
  return { rootDir, checkoutPath };
}

function preview() {
  return {
    labels: [
      { name: 'paseo:ready', status: 'reused', existingColor: 'abcdef', existingDescription: 'custom' },
      { name: 'paseo:queued', status: 'missing', existingColor: null, existingDescription: null },
    ],
    setupPullRequestChanges: ['.github/ISSUE_TEMPLATE/automated-coding-task.md'],
  };
}

test('confirmation binds repository, future issue base, setup branch, files, and defaults auto-merge on', (t) => {
  const { rootDir } = setup(t);
  const confirmation = getSetupPullRequestConfirmation({ rootDir, previewBuilder: preview });
  assert.equal(confirmation.repository, 'octo/app');
  assert.equal(confirmation.selectedBaseBranch, 'release');
  assert.equal(confirmation.issuePullRequestBaseBranch, 'release');
  assert.equal(confirmation.setupBranch, 'ai/install-paseo-automation');
  assert.deepEqual(confirmation.files, ['.github/ISSUE_TEMPLATE/automated-coding-task.md']);
  assert.equal(confirmation.autoMerge, true);
});

test('confirmation fails closed when the issue PR target or file list changes', (t) => {
  const { rootDir } = setup(t);
  const expected = getSetupPullRequestConfirmation({ rootDir, previewBuilder: preview });
  assert.throws(() => validateSetupPullRequestConfirmation({
    ...expected,
    issuePullRequestBaseBranch: 'main',
    confirmSameBaseBranch: true,
  }, { rootDir, previewBuilder: preview }), /same base branch/);
  assert.throws(() => validateSetupPullRequestConfirmation({
    ...expected,
    files: [...expected.files, 'README.md'],
    confirmSameBaseBranch: true,
  }, { rootDir, previewBuilder: preview }), /file list changed/);
  const accepted = validateSetupPullRequestConfirmation({
    ...expected,
    autoMerge: false,
    confirmSameBaseBranch: true,
  }, { rootDir, previewBuilder: preview });
  assert.equal(accepted.autoMerge, false);
  assert.equal(accepted.confirmed, true);
});

test('confirmed label installation reuses custom metadata and creates only missing labels', (t) => {
  const { checkoutPath } = setup(t);
  const calls = [];
  const result = installConfirmedLifecycleLabels('octo/app', checkoutPath, {
    jsonRunner() {
      return [{ name: 'paseo:ready', color: 'ff00ff', description: 'user custom' }];
    },
    runner(command, args) {
      calls.push([command, ...args]);
      return { ok: true, stdout: '', stderr: '', exitCode: 0 };
    },
  });
  const reused = result.find((item) => item.name === 'paseo:ready');
  assert.equal(reused.action, 'reused');
  assert.equal(reused.color, 'ff00ff');
  assert.equal(reused.description, 'user custom');
  assert.equal(calls.some((call) => call.includes('paseo:ready')), false);
  assert.equal(result.filter((item) => item.action === 'created').length, result.length - 1);
});

test('auto-merge failure remains policy-respecting and actionable instead of bypassing protections', () => {
  const result = requestSetupPullRequestAutoMerge('/repo', { number: 17 }, {
    runner(_command, args) {
      assert.deepEqual(args, ['pr', 'merge', '17', '--auto', '--merge']);
      return { ok: false, stdout: '', stderr: 'auto-merge is not allowed', exitCode: 1 };
    },
  });
  assert.equal(result.requested, true);
  assert.equal(result.enabled, false);
  assert.match(result.reason, /not allowed/);
  assert.match(result.action, /without bypassing checks, reviews, protections, or rulesets/);
});

test('setup remains blocked until merge, local sync, and installed-content verification all succeed', () => {
  assert.equal(confirmedSetupPullRequestReady(null), true);
  assert.equal(confirmedSetupPullRequestReady({ state: 'open' }), false);
  assert.equal(confirmedSetupPullRequestReady({ state: 'merged', syncedAt: 'now' }), false);
  assert.equal(confirmedSetupPullRequestReady({ state: 'merged', syncedAt: 'now', installationVerifiedAt: 'later' }), true);
});
