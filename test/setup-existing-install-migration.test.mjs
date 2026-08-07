import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_LABELS, PASEO_LABELS } from '../src/label-catalog.mjs';
import {
  applyExistingInstallationMigration,
  completeExistingInstallationMigration,
  previewExistingInstallationMigration,
} from '../src/setup-existing-install-migration.mjs';
import { loadConfig, loadRuntime, saveRuntime, statePaths } from '../src/state.mjs';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  const paths = statePaths(root);
  writeFileSync(paths.config, JSON.stringify({
    version: 2,
    setupComplete: true,
    baseBranch: 'main',
    maxActive: 1,
    pollIntervalSeconds: 120,
    maxReviewRounds: 4,
    codingHarness: 'paseo',
    models: { orchestrator: 'openai/coder', coder: 'openai/coder', reviewer: 'openai/reviewer' },
    workspace: { id: 'ws-1', title: 'Issue Coding Automation' },
  }, null, 2));
  saveRuntime(root, { claimsEnabled: true, skippedIssueNumbers: [22] });
  return root;
}

function issues() {
  return [
    { number: 1, labels: [{ name: LEGACY_LABELS.ready }] },
    { number: 2, labels: [{ name: LEGACY_LABELS.failed }] },
    { number: 3, labels: [{ name: LEGACY_LABELS.humanReview }] },
    { number: 4, labels: [{ name: LEGACY_LABELS.blocked }] },
    { number: 5, labels: [{ name: LEGACY_LABELS.running }] },
    { number: 6, labels: [{ name: PASEO_LABELS.reviewing }] },
  ];
}

test('migration preview covers current external/embedded-compatible state without mutating active work', (t) => {
  const root = repo(t);
  const preview = previewExistingInstallationMigration(root, {
    repository: 'octo/app',
    issueLoader: () => issues(),
    templateContract: (issue) => issue.number === 1 ? { ok: true } : { ok: false, reason: 'missing acceptance criteria' },
  });
  assert.equal(preview.config.storedVersion, 2);
  assert.equal(preview.config.targetVersion, 3);
  assert.equal(preview.safeToApply, true);
  assert.equal(preview.safety.stopCodingWorkers, true);
  assert.equal(preview.safety.stopReviewWorkers, true);
  assert.equal(preview.safety.rewriteActivePullRequestHeads, false);
  assert.equal(preview.safety.deleteUserOwnedLabels, false);
  assert.deepEqual(preview.runtime.dependencyWaitingIssueNumbers, [4]);
  assert.deepEqual(preview.issues.find((item) => item.issueNumber === 1).addLabels, [PASEO_LABELS.ready]);
  assert.deepEqual(preview.issues.find((item) => item.issueNumber === 2).addLabels, [PASEO_LABELS.failed, PASEO_LABELS.needsAttention]);
  assert.equal(preview.issues.find((item) => item.issueNumber === 3).localState, 'manual-review');
  assert.equal(preview.issues.find((item) => item.issueNumber === 4).localState, 'dependency-waiting');
  assert.equal(preview.issues.find((item) => item.issueNumber === 5).localState, 'coding');
  assert.equal(preview.issues.find((item) => item.issueNumber === 6).addLabels.length, 0);
  assert.equal(preview.integration.templateOwnershipHashChange, 'setup-pr-only');
});

test('legacy ready migrates only when current issue contract passes', (t) => {
  const root = repo(t);
  const preview = previewExistingInstallationMigration(root, {
    repository: 'octo/app',
    issueLoader: () => [{ number: 9, labels: [{ name: LEGACY_LABELS.ready }] }],
    templateContract: () => ({ ok: false, reason: 'Planning section is empty.' }),
  });
  const issue = preview.issues[0];
  assert.deepEqual(issue.addLabels, [PASEO_LABELS.needsAttention]);
  assert.equal(issue.localState, 'invalid');
  assert.match(issue.note, /Planning section/);
});

test('conflicting active legacy labels stop migration before any mutation', (t) => {
  const root = repo(t);
  const preview = previewExistingInstallationMigration(root, {
    repository: 'octo/app',
    issueLoader: () => [{ number: 10, labels: [{ name: LEGACY_LABELS.running }, { name: LEGACY_LABELS.humanReview }] }],
  });
  assert.equal(preview.safeToApply, false);
  assert.equal(preview.ambiguities.length, 1);
  assert.throws(() => applyExistingInstallationMigration(root, preview), /ambiguous/);
  assert.equal(loadRuntime(root).claimsEnabled, true);
});

test('apply stops workers, pauses claims, upgrades config, adds only new labels, and does not restart active work', (t) => {
  const root = repo(t);
  const preview = previewExistingInstallationMigration(root, {
    repository: 'octo/app',
    issueLoader: () => issues(),
    templateContract: () => ({ ok: true }),
  });
  const calls = [];
  const runner = (_command, args) => { calls.push(args); return { ok: true, stdout: '', stderr: '' }; };
  const stopped = [];
  const record = applyExistingInstallationMigration(root, preview, {
    runner,
    workerManager: { stop(value) { stopped.push(['coding', value]); } },
    reviewWorkerManager: { stop(value) { stopped.push(['review', value]); } },
  });
  assert.equal(record.state, 'awaiting-reconciliation');
  assert.equal(record.activeWorkRestarted, false);
  assert.equal(record.templateSetupPullRequestRequired, true);
  assert.equal(loadRuntime(root).claimsEnabled, false);
  assert.equal(loadConfig(root).version, 3);
  assert.deepEqual(stopped, [['coding', 'octo/app'], ['review', 'octo/app']]);
  assert.ok(calls.every((args) => args[0] === 'issue' && args[1] === 'edit' && args.includes('--add-label')));
  assert.ok(calls.every((args) => !args.includes('--remove-label')));
});

test('migration completion requires reconciliation and reviewed template setup PR', (t) => {
  const root = repo(t);
  const preview = previewExistingInstallationMigration(root, {
    repository: 'octo/app',
    issueLoader: () => [],
  });
  applyExistingInstallationMigration(root, preview, { runner: () => ({ ok: true }) });
  assert.throws(() => completeExistingInstallationMigration(root, { reconciliationOk: false, setupPullRequestReady: true }), /reconcile/);
  assert.throws(() => completeExistingInstallationMigration(root, { reconciliationOk: true, setupPullRequestReady: false }), /setup PR/);
  const done = completeExistingInstallationMigration(root, { reconciliationOk: true, setupPullRequestReady: true });
  assert.equal(done.state, 'completed');
  assert.equal(done.activeWorkRestarted, false);
  assert.match(done.preview.rollback.machineLocalState, /pre-migration/);
});
