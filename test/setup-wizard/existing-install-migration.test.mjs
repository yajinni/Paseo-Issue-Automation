import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PASEO_LABELS } from '../../src/label-catalog.mjs';
import { DEFAULT_CONFIG, loadRuntime, saveConfig, saveRuntime } from '../../src/state.mjs';
import {
  applyExistingInstallMigration,
  buildExistingInstallMigrationPlan,
  classifyLegacyIssueForMigration,
  loadExistingInstallMigration,
  migrationPreservesCurrentReviewLabel,
} from '../../src/setup-wizard/existing-install-migration.mjs';

const VALID_BODY = `
## Objective
Implement the requested behavior safely.

## Required behavior
- Preserve existing behavior while making the requested change.

## Acceptance criteria
- [x] The requested behavior is implemented.

## Validation and checks
- Run focused and full validation.

## Stop conditions
- Stop on an unsafe or ambiguous migration state.
`;

function repositoryFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-existing-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  saveConfig(root, {
    ...DEFAULT_CONFIG,
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    codingHarness: 'paseo',
    models: {
      ...DEFAULT_CONFIG.models,
      coder: 'test/coder',
      reviewer: 'test/reviewer',
    },
    workspace: { id: 'ws-existing', title: 'Issue Coding Automation' },
  });
  saveRuntime(root, {
    claimsEnabled: true,
    lastDispatchAt: '2026-08-07T00:00:00.000Z',
    lastDispatchResult: { claimed: [12] },
    skippedIssueNumbers: [4, 9],
  });
  return root;
}

test('legacy issue labels migrate without inventing a blocked lifecycle label', () => {
  const ready = classifyLegacyIssueForMigration({ number: 10, labels: ['agent-ready', 'user-label'], body: VALID_BODY });
  assert.deepEqual(ready.addLabels, [PASEO_LABELS.ready]);
  assert.deepEqual(ready.removeLabels, ['agent-ready']);
  assert.deepEqual(ready.preserveLabels, ['user-label']);

  const waiting = classifyLegacyIssueForMigration({ number: 11, labels: ['agent-blocked'], blockedByOpen: true, body: VALID_BODY });
  assert.equal(waiting.dependencyWaiting, true);
  assert.deepEqual(waiting.addLabels, []);
  assert.deepEqual(waiting.removeLabels, ['agent-blocked']);

  const invalid = classifyLegacyIssueForMigration({ number: 12, labels: ['agent-ready'], body: '## Objective\nplaceholder' });
  assert.deepEqual(invalid.addLabels, [PASEO_LABELS.needsAttention]);
  assert.match(invalid.notes.join(' '), /does not pass the current issue contract/i);
});

test('failed and manual-review legacy states retain their distinct lifecycle meaning', () => {
  const failed = classifyLegacyIssueForMigration({ number: 20, labels: ['agent-failed'] });
  assert.deepEqual(failed.addLabels, [PASEO_LABELS.failed, PASEO_LABELS.needsAttention]);

  const manual = classifyLegacyIssueForMigration({ number: 21, labels: ['human-review', PASEO_LABELS.reviewing] });
  assert.deepEqual(manual.addLabels, [PASEO_LABELS.reviewQueued]);
  assert.ok(manual.preserveLabels.includes(PASEO_LABELS.reviewing));
  assert.equal(migrationPreservesCurrentReviewLabel(PASEO_LABELS.reviewing), true);
});

test('migration preview is fail-closed for ambiguous blocked state and pending setup PR', () => {
  const plan = buildExistingInstallMigrationPlan({
    configVersion: 2,
    controllerMode: 'external-manager',
    issues: [{ number: 30, labels: ['agent-blocked'], blockedByOpen: false }],
    setupPullRequest: { number: 379, state: 'open' },
    templateCurrent: false,
    activeCoding: [{ issueNumber: 31 }],
    openPullRequests: [{ number: 400 }],
    reviewJobs: [{ id: 'review-1' }],
    fixJobs: [{ id: 'fix-1' }],
    skippedIssueNumbers: [8, 8, 3],
    historyCount: 14,
  });
  assert.equal(plan.canApply, false);
  assert.deepEqual(plan.blockers.map((item) => item.code).sort(), ['ambiguous-legacy-blocked-state', 'pending-setup-pull-request']);
  assert.equal(plan.template.setupPullRequestRequired, true);
  assert.equal(plan.template.trackedFileMutationAllowedDirectly, false);
  assert.equal(plan.preserved.activeCodingCount, 1);
  assert.equal(plan.preserved.openPullRequestCount, 1);
  assert.equal(plan.preserved.reviewJobCount, 1);
  assert.equal(plan.preserved.fixJobCount, 1);
  assert.deepEqual(plan.preserved.skippedIssueNumbers, [3, 8]);
  assert.equal(plan.preserved.activeWorkRestarted, false);
  assert.equal(plan.preserved.prHeadsRewritten, false);
  assert.equal(plan.preserved.userOwnedLabelsDeleted, false);
  assert.match(plan.rollback.machineLocalState, /back up/i);
});

test('apply requires stopped workers, pauses claims, preserves runtime history, and writes a separate audit', (t) => {
  const root = repositoryFixture(t);
  const plan = buildExistingInstallMigrationPlan({
    configVersion: 3,
    templateCurrent: true,
    issues: [
      { number: 40, labels: ['agent-ready'], body: VALID_BODY },
      { number: 41, labels: ['agent-blocked'], blockedByOpen: true, body: VALID_BODY },
    ],
    skippedIssueNumbers: [4, 9],
    historyCount: 2,
  });
  assert.equal(plan.canApply, true);

  assert.throws(() => applyExistingInstallMigration(root, {
    plan,
    repositoryId: 'repo-1',
    workerManager: { status: () => ({ running: true }) },
  }), /Stop the coding worker/);
  assert.equal(loadRuntime(root).claimsEnabled, true);

  const labels = [];
  const waits = [];
  const audit = applyExistingInstallMigration(root, {
    plan,
    repositoryId: 'repo-1',
    workerManager: { status: () => ({ running: false }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
    applyIssueLabels(issueNumber, change) { labels.push({ issueNumber, ...change }); },
    saveDependencyWait(issueNumber, value) { waits.push({ issueNumber, ...value }); },
    now: () => new Date('2026-08-07T04:30:00.000Z'),
  });

  const runtime = loadRuntime(root);
  assert.equal(runtime.claimsEnabled, false);
  assert.equal(runtime.lastDispatchAt, '2026-08-07T00:00:00.000Z');
  assert.deepEqual(runtime.lastDispatchResult, { claimed: [12] });
  assert.deepEqual(runtime.skippedIssueNumbers, [4, 9]);
  assert.deepEqual(labels, [
    { issueNumber: 40, add: [PASEO_LABELS.ready], remove: ['agent-ready'] },
    { issueNumber: 41, add: [], remove: ['agent-blocked'] },
  ]);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].issueNumber, 41);
  assert.equal(audit.status, 'completed');
  assert.equal(audit.claimsEnabled, false);
  assert.deepEqual(loadExistingInstallMigration(root), audit);
});

test('template drift remains a reviewed setup-PR follow-up and never completes migration early', (t) => {
  const root = repositoryFixture(t);
  const plan = buildExistingInstallMigrationPlan({ configVersion: 3, templateCurrent: false });
  const audit = applyExistingInstallMigration(root, {
    plan,
    repositoryId: 'repo-1',
    workerManager: { status: () => ({ running: false }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
  });
  assert.equal(audit.status, 'awaiting-template-reconciliation');
  assert.equal(audit.templateSetupPullRequestRequired, true);
  assert.equal(loadRuntime(root).claimsEnabled, false);
});
