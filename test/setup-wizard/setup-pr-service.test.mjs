import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveSetupPullRequest } from '../../src/setup-pr.mjs';
import {
  confirmedSetupPullRequestReady,
  getSetupPullRequestConfirmation,
  installConfirmedLifecycleLabels,
  repairSetupRepository,
  requestSetupPullRequestAutoMerge,
  validateSetupPullRequestConfirmation,
} from '../../src/setup-wizard/setup-pr-service.mjs';
import { saveSetupPage, startSetupSession } from '../../src/setup-wizard/store.mjs';
import { saveConfig } from '../../src/state.mjs';

const TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/automated-coding-task.md';

function setup(t, { legacyCheckoutPage = true, configuredBaseBranch = 'release' } = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'setup-pr-confirmation-'));
  const checkoutPath = mkdtempSync(path.join(os.tmpdir(), 'setup-pr-checkout-'));
  t.after(() => {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(checkoutPath, { recursive: true, force: true });
  });
  execFileSync('git', ['init', '-b', 'release'], { cwd: checkoutPath, stdio: 'ignore' });
  startSetupSession({ rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'release',
    selections: {
      host: 'github.com',
      account: 'octo',
      repository: 'octo/app',
      baseBranch: 'release',
      checkoutPath,
    },
  }, { rootDir });
  if (legacyCheckoutPage) {
    saveSetupPage('checkout', {
      selections: { checkoutPath, checkoutManaged: true },
    }, { rootDir });
  }
  saveConfig(checkoutPath, { setupComplete: false, baseBranch: configuredBaseBranch, maxActive: 1, models: {}, workspace: {} });
  return { rootDir, checkoutPath };
}

function preview() {
  return {
    labels: [
      { name: 'paseo:ready', status: 'reused', existingColor: 'abcdef', existingDescription: 'custom' },
      { name: 'paseo:queued', status: 'missing', existingColor: null, existingDescription: null },
    ],
    labelSummary: { missing: 1, reused: 1, pending: 0 },
    setupPullRequestChanges: [TEMPLATE_PATH],
    template: { path: TEMPLATE_PATH, status: 'update', setupPrChangeRequired: true },
    previewErrors: { labels: null, template: null },
  };
}

function currentPreview() {
  return {
    labels: [],
    labelSummary: { missing: 0, reused: 0, pending: 0 },
    setupPullRequestChanges: [],
    template: { path: TEMPLATE_PATH, status: 'current', setupPrChangeRequired: false },
    previewErrors: { labels: null, template: null },
  };
}

test('confirmation binds repository, future issue base, setup branch, files, and defaults auto-merge on', (t) => {
  const { rootDir } = setup(t);
  const confirmation = getSetupPullRequestConfirmation({ rootDir, previewBuilder: preview });
  assert.equal(confirmation.repository, 'octo/app');
  assert.equal(confirmation.selectedBaseBranch, 'release');
  assert.equal(confirmation.issuePullRequestBaseBranch, 'release');
  assert.equal(confirmation.setupBranch, 'ai/install-paseo-automation');
  assert.deepEqual(confirmation.files, [TEMPLATE_PATH]);
  assert.equal(confirmation.autoMerge, true);
});

test('simplified setup can resolve the checkout directly from the repository page', (t) => {
  const { rootDir } = setup(t, { legacyCheckoutPage: false });
  const confirmation = getSetupPullRequestConfirmation({ rootDir, previewBuilder: preview });
  assert.equal(confirmation.repository, 'octo/app');
  assert.deepEqual(confirmation.files, [TEMPLATE_PATH]);
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

test('automatic setup repair fixes missing direct labels without creating a PR when managed files are current', (t) => {
  const { rootDir } = setup(t, { legacyCheckoutPage: false });
  let pullRequestCreated = false;
  const result = repairSetupRepository({
    rootDir,
    reconciler: () => null,
    previewBuilder: () => ({
      ...currentPreview(),
      labelSummary: { missing: 1, reused: 0, pending: 0 },
      labels: [{ name: 'paseo:ready', status: 'missing' }],
    }),
    labelInstaller: () => [{ name: 'paseo:ready', action: 'created' }],
    pullRequestCreator: () => { pullRequestCreated = true; return { created: true }; },
  });
  assert.equal(result.ready, true);
  assert.equal(result.action, 'repaired-directly');
  assert.match(result.summary, /Created 1 missing lifecycle label/);
  assert.equal(pullRequestCreated, false);
});

test('automatic setup repair initializes an unconfigured checkout after verifying its current base branch', (t) => {
  const { rootDir, checkoutPath } = setup(t, { legacyCheckoutPage: false, configuredBaseBranch: '' });
  const result = repairSetupRepository({
    rootDir,
    reconciler: () => null,
    previewBuilder: preview,
    labelInstaller: () => [],
    templateInstaller: () => ({ path: TEMPLATE_PATH, updated: true }),
    pullRequestCreator: (root) => {
      const pullRequest = {
        number: 19,
        url: 'https://github.test/pr/19',
        state: 'open',
        branch: 'ai/install-paseo-automation-20260807t154500z',
        baseBranch: 'release',
        files: [TEMPLATE_PATH],
      };
      saveSetupPullRequest(root, pullRequest);
      return { created: true, pullRequest };
    },
    autoMergeRequester: () => ({ requested: false, enabled: false, reason: 'disabled', action: null }),
  });
  assert.equal(result.action, 'created-pr');
  assert.equal(result.pullRequest.number, 19);
  assert.equal(result.pullRequest.baseBranch, 'release');
  assert.equal(result.pullRequest.files[0], TEMPLATE_PATH);
});

test('automatic setup repair rejects an unconfigured checkout on a different branch', (t) => {
  const { rootDir } = setup(t, { legacyCheckoutPage: false, configuredBaseBranch: '' });
  saveSetupPage('repository', { baseBranch: 'main', selections: { baseBranch: 'main' } }, { rootDir });
  assert.throws(() => repairSetupRepository({
    rootDir,
    reconciler: () => null,
    previewBuilder: preview,
    labelInstaller: () => [],
    pullRequestCreator: () => ({ created: false }),
  }), /managed checkout current branch release/);
});

test('automatic setup repair creates a new fix PR for missing or outdated managed files', (t) => {
  const { rootDir, checkoutPath } = setup(t, { legacyCheckoutPage: false });
  let installedTemplateAt = null;
  let createdAt = null;
  let autoMergeRequested = null;
  const result = repairSetupRepository({
    rootDir,
    reconciler: () => ({ number: 17, state: 'closed', url: 'https://github.test/pr/17' }),
    previewBuilder: preview,
    labelInstaller: () => [],
    templateInstaller: (root) => { installedTemplateAt = root; return { path: TEMPLATE_PATH, updated: true }; },
    pullRequestCreator: (root) => {
      createdAt = root;
      const pullRequest = {
        number: 18,
        url: 'https://github.test/pr/18',
        state: 'open',
        branch: 'ai/install-paseo-automation-20260807t154500z',
        baseBranch: 'release',
        files: [TEMPLATE_PATH],
      };
      saveSetupPullRequest(root, pullRequest);
      return { created: true, pullRequest };
    },
    autoMergeRequester: (root, pullRequest) => {
      autoMergeRequested = { root, number: pullRequest.number };
      return { requested: true, enabled: true, reason: null, action: null };
    },
  });
  assert.equal(result.ready, false);
  assert.equal(result.action, 'created-pr');
  assert.equal(result.pullRequest.number, 18);
  assert.equal(installedTemplateAt, checkoutPath);
  assert.equal(createdAt, checkoutPath);
  assert.deepEqual(autoMergeRequested, { root: checkoutPath, number: 18 });
  assert.match(result.summary, /Setup issues detected\. Paseo created setup PR #18 to fix them/);
  assert.match(result.summary, /Auto-merge was requested/);
});

test('automatic setup repair reuses an already-open setup PR instead of creating a duplicate', (t) => {
  const { rootDir } = setup(t, { legacyCheckoutPage: false });
  let created = false;
  const result = repairSetupRepository({
    rootDir,
    reconciler: () => ({ number: 21, state: 'open', url: 'https://github.test/pr/21' }),
    previewBuilder: preview,
    labelInstaller: () => [],
    pullRequestCreator: () => { created = true; return { created: true }; },
  });
  assert.equal(result.ready, false);
  assert.equal(result.action, 'waiting-pr');
  assert.equal(result.pullRequest.number, 21);
  assert.equal(created, false);
  assert.match(result.summary, /Setup issues detected\. Setup PR #21 is open to fix them/);
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
