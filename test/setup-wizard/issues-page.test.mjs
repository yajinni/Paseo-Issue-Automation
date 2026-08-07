import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildIssueInstallationPreview,
  getIssuesSetupPageStatus,
  recheckIssuesSetupPage,
  saveIssuesSetupPage,
} from '../../src/setup-wizard/issues-page-service.mjs';
import { loadSetupSessionStore, saveSetupPage, startSetupSession } from '../../src/setup-wizard/store.mjs';

function setup(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'issues-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'main',
    selections: { host: 'github.com', account: 'octo', repository: 'octo/app', baseBranch: 'main' },
  }, { rootDir });
  saveSetupPage('checkout', { selections: { checkoutPath: '/managed/octo--app', checkoutManaged: true } }, { rootDir });
  return rootDir;
}

function preview() {
  return {
    labels: [
      { name: 'paseo:ready', status: 'reused', existingColor: 'abcdef', existingDescription: 'custom', willOverwriteExistingMetadata: false, action: 'Reuse.' },
      { name: 'paseo:queued', status: 'missing', existingColor: null, existingDescription: null, willOverwriteExistingMetadata: false, action: 'Create.' },
    ],
    labelSummary: { missing: 1, reused: 1 },
    template: { path: '.github/ISSUE_TEMPLATE/automated-coding-task.md', status: 'update', setupPrChangeRequired: true, message: 'Update through setup PR.' },
    directGitHubChanges: ['Create missing managed lifecycle labels after final confirmation.'],
    setupPullRequestChanges: ['.github/ISSUE_TEMPLATE/automated-coding-task.md'],
  };
}

test('issues page defaults are safe and installation preview is read-only', (t) => {
  const rootDir = setup(t);
  let calls = 0;
  const status = getIssuesSetupPageStatus({ rootDir, previewLoader() { calls += 1; return preview(); } });
  assert.equal(calls, 1);
  assert.deepEqual(status.selection, { mode: 'recommended-labels', maxActive: 1, temporaryFailureRetries: 3, excludedLabels: [] });
  assert.equal(status.preview.labelSummary.missing, 1);
  assert.equal(status.preview.labelSummary.reused, 1);
  assert.equal(status.preview.labels[0].willOverwriteExistingMetadata, false);
  assert.equal(status.preview.template.setupPrChangeRequired, true);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.issues.completed, false);
});

test('saving issue settings validates ranges and completes only the issues page', (t) => {
  const rootDir = setup(t);
  const options = { rootDir, previewLoader: preview };
  const result = saveIssuesSetupPage({
    mode: 'all-open',
    maxActive: 20,
    temporaryFailureRetries: 3,
    excludedLabels: ['skip-me', 'wont-fix', 'skip-me'],
  }, options);
  assert.equal(result.check.ok, true);
  assert.deepEqual(result.selection.excludedLabels, ['skip-me', 'wont-fix']);
  assert.equal(result.selection.maxActive, 20);
  const session = loadSetupSessionStore({ rootDir }).activeSession;
  assert.equal(session.pages.issues.completed, true);
  assert.equal(session.pages.review.completed, false);

  const invalid = saveIssuesSetupPage({ maxActive: 21 }, options);
  assert.equal(invalid.check.ok, false);
  assert.equal(invalid.check.blockers[0].code, 'issues-max-active-invalid');
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.issues.completed, false);
});

test('recheck blocks when installation preview cannot be proven', (t) => {
  const rootDir = setup(t);
  saveIssuesSetupPage({}, { rootDir, previewLoader: preview });
  const result = recheckIssuesSetupPage({ rootDir, previewLoader() { throw new Error('GitHub unavailable'); } });
  assert.equal(result.check.ok, false);
  assert.equal(result.check.blockers[0].code, 'issues-installation-preview-unavailable');
  assert.match(result.technicalDetails.previewError, /GitHub unavailable/);
});

test('label preview distinguishes reused and missing labels without overwriting custom metadata', () => {
  const result = buildIssueInstallationPreview({ repository: 'octo/app', checkoutPath: '/repo' }, {
    labelLoader: () => [{ name: 'paseo:ready', color: 'ff00ff', description: 'user custom' }],
    templatePreviewLoader: () => ({ path: '.github/ISSUE_TEMPLATE/automated-coding-task.md', status: 'current', setupPrChangeRequired: false, message: 'Current.' }),
  });
  const ready = result.labels.find((label) => label.name === 'paseo:ready');
  const queued = result.labels.find((label) => label.name === 'paseo:queued');
  assert.equal(ready.status, 'reused');
  assert.equal(ready.existingColor, 'ff00ff');
  assert.equal(ready.existingDescription, 'user custom');
  assert.equal(ready.willOverwriteExistingMetadata, false);
  assert.equal(queued.status, 'missing');
  assert.equal(result.setupPullRequestChanges.length, 0);
});
