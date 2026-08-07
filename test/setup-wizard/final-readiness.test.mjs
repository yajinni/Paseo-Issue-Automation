import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addRepository } from '../../src/repository-registry.mjs';
import { loadConfig, loadRuntime, saveConfig } from '../../src/state.mjs';
import {
  buildFinalReadinessSummary,
  finishSetup,
  runFinalReadinessChecks,
} from '../../src/setup-wizard/final-readiness-service.mjs';
import { FINAL_READINESS_SCRIPT } from '../../src/setup-wizard/final-readiness-ui.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
  startSetupSession,
} from '../../src/setup-wizard/store.mjs';

const PRIOR_PAGES = ['paseo', 'harness', 'repository', 'issues', 'review'];
const TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/automated-coding-task.md';

function readySetupPreview() {
  return {
    labels: [],
    labelSummary: { missing: 0, reused: 0, pending: 0 },
    setupPullRequestChanges: [],
    template: { path: TEMPLATE_PATH, status: 'current', setupPrChangeRequired: false },
    previewErrors: { labels: null, template: null },
  };
}

function fixture(t, { eligibleIssueCount = 0 } = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-readiness-manager-'));
  const repo = mkdtempSync(path.join(os.tmpdir(), 'paseo-readiness-repo-'));
  t.after(() => { rmSync(rootDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/octo/app.git'], { cwd: repo });
  addRepository(repo, { rootDir });
  saveConfig(repo, {
    version: 3,
    setupComplete: false,
    baseBranch: 'main',
    pollIntervalSeconds: 120,
    maxActive: 1,
    codingHarness: 'paseo',
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 3 },
    review: { workflow: 'quick-manual', quickMaxRounds: 3, fullMaxRounds: 3, autoMergeApproved: false },
    models: { coder: 'openai/coder', reviewer: 'openai/reviewer', coderThinking: '', reviewerThinking: '', orchestrator: 'openai/coder' },
    workspace: { id: 'ws-1', title: 'Issue Coding Automation' },
  });
  startSetupSession({ rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'main',
    selections: {
      repository: 'octo/app',
      baseBranch: 'main',
      checkoutPath: repo,
      paseoRepository: 'octo/app',
      paseoBaseBranch: 'main',
      paseoProjectName: 'app',
      paseoWorkspaceId: 'ws-1',
      paseoWorkspaceName: 'Issue Coding Automation',
    },
    managedCheckout: { path: repo, managed: false, workspaceId: 'ws-1' },
  }, { rootDir });
  saveSetupPage('issues', { selections: { eligibleIssueCount } }, { rootDir });
  for (const page of PRIOR_PAGES) recordSetupPageCheck(page, { ok: true, summary: `${page} ready`, blockers: [] }, { rootDir });
  return { rootDir, repo };
}

test('summary links every visible prerequisite setup page and defaults start based on current eligibility', (t) => {
  const { rootDir } = fixture(t, { eligibleIssueCount: 2 });
  const summary = buildFinalReadinessSummary({ rootDir, eligibleIssueCount: 2 });
  assert.equal(summary.repository, 'octo/app');
  assert.equal(summary.baseBranch, 'main');
  assert.equal(summary.pages.length, 5);
  assert.deepEqual(summary.pages.map((page) => page.id), PRIOR_PAGES);
  assert.ok(summary.pages.every((page) => page.href === `/setup/${page.id}` && page.completed));
  assert.equal(summary.startAutomationDefault, true);
  assert.equal(buildFinalReadinessSummary({ rootDir, eligibleIssueCount: 0 }).startAutomationDefault, false);
});

test('readiness is fail-closed and safe probes cannot silently pass a failed prerequisite', async (t) => {
  const { rootDir } = fixture(t);
  const session = loadSetupSessionStore({ rootDir }).activeSession;
  assert.equal(session.pages.review.completed, true);
  const result = await runFinalReadinessChecks({
    rootDir,
    setupPrReconciler: () => null,
    setupInstallationPreviewBuilder: readySetupPreview,
    safeProbes: [async () => ({ id: 'temporary-worktree', ok: true, summary: 'Created and removed temporary probe.' })],
  });
  assert.equal(result.check.ok, true);
  assert.deepEqual(result.safeProbePolicy, {
    fakeIssueCreated: false,
    fakeReviewCreated: false,
    applicationCodeChanged: false,
    paidPromptSent: false,
  });
  assert.equal(result.checks.find((item) => item.id === 'temporary-worktree').ok, true);
});

test('a closed historical setup PR does not block when repository setup files are already installed', async (t) => {
  const { rootDir } = fixture(t);
  const result = await runFinalReadinessChecks({
    rootDir,
    setupPrReconciler: () => ({ number: 17, state: 'closed', syncedAt: null, installationVerifiedAt: null }),
    setupInstallationPreviewBuilder: readySetupPreview,
  });
  const setup = result.checks.find((item) => item.id === 'setup-pull-request');
  assert.equal(setup.ok, true);
  assert.equal(setup.informational, false);
  assert.equal(setup.state, 'none');
  assert.equal(setup.pullRequestState, 'closed');
  assert.equal(setup.summary, 'Repository setup files and lifecycle labels are current.');
  assert.equal(result.check.ok, true);
});

test('an open setup repair PR is informational and does not block finishing setup', async (t) => {
  const { rootDir, repo } = fixture(t);
  const result = await runFinalReadinessChecks({
    rootDir,
    setupRepairer: async () => ({
      ready: false,
      issuesDetected: true,
      action: 'created-pr',
      summary: 'Setup issues detected. Paseo created setup PR #18 to fix them. Auto-merge was requested through normal repository policy.',
      files: [TEMPLATE_PATH],
      pullRequest: { number: 18, url: 'https://github.test/pr/18', state: 'open' },
      autoMerge: { requested: true, enabled: true },
    }),
  });
  const setup = result.checks.find((item) => item.id === 'setup-pull-request');
  assert.equal(setup.ok, false);
  assert.equal(setup.informational, true);
  assert.equal(setup.label, 'setup pull request');
  assert.equal(setup.state, 'created-pr');
  assert.equal(setup.number, 18);
  assert.equal(setup.url, 'https://github.test/pr/18');
  assert.deepEqual(setup.pendingFiles, [TEMPLATE_PATH]);
  assert.equal(result.check.ok, true);
  assert.equal(result.check.blockers.some((item) => item.code === 'readiness-repository-setup-pending'), false);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.readiness.completed, true);

  const finished = await finishSetup({ startAutomation: false }, { rootDir });
  assert.equal(finished.completed, true);
  assert.equal(loadConfig(repo).setupComplete, true);
});

test('a merged setup PR waiting for local synchronization is also informational', async (t) => {
  const { rootDir } = fixture(t);
  const result = await runFinalReadinessChecks({
    rootDir,
    setupRepairer: async () => ({
      ready: false,
      issuesDetected: true,
      action: 'waiting-sync',
      summary: 'Setup PR #18 merged with the required fixes. Paseo is waiting to synchronize the selected base branch.',
      files: [TEMPLATE_PATH],
      pullRequest: { number: 18, url: 'https://github.test/pr/18', state: 'merged' },
    }),
  });
  const setup = result.checks.find((item) => item.id === 'setup-pull-request');
  assert.equal(setup.informational, true);
  assert.equal(result.check.ok, true);
});

test('final readiness reports a repair failure and remains retryable', async (t) => {
  const { rootDir } = fixture(t);
  const result = await runFinalReadinessChecks({
    rootDir,
    setupRepairer: () => { throw new Error('cannot push setup branch'); },
  });
  const setup = result.checks.find((item) => item.id === 'setup-pull-request');
  assert.equal(setup.ok, false);
  assert.equal(setup.informational, false);
  assert.equal(setup.state, 'repair-failed');
  assert.match(setup.summary, /cannot push setup branch/);
  assert.equal(result.check.blockers.some((item) => item.code === 'readiness-repository-setup-repair-failed'), true);
});

test('Finish setup commits durable state before workers and only then enables claims', async (t) => {
  const { rootDir, repo } = fixture(t, { eligibleIssueCount: 1 });
  await runFinalReadinessChecks({ rootDir, setupPrReconciler: () => null, setupInstallationPreviewBuilder: readySetupPreview });
  const observed = [];
  const workerManager = { start(repository) { observed.push({ type: 'coding', setup: loadConfig(repo).setupComplete, claims: loadRuntime(repo).claimsEnabled, repository }); return { running: true }; } };
  const reviewWorkerManager = { start(repository) { observed.push({ type: 'review', setup: loadConfig(repo).setupComplete, claims: loadRuntime(repo).claimsEnabled, repository }); return { running: true }; } };
  const result = await finishSetup({ startAutomation: true }, { rootDir, workerManager, reviewWorkerManager });
  assert.equal(result.completed, true);
  assert.equal(result.workersStarted, true);
  assert.equal(loadConfig(repo).setupComplete, true);
  assert.equal(loadRuntime(repo).claimsEnabled, true);
  assert.equal(observed.length, 2);
  assert.ok(observed.every((entry) => entry.setup === true && entry.claims === true));
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession, null);
});

test('worker startup failure is recoverable and returns automation to paused state', async (t) => {
  const { rootDir, repo } = fixture(t);
  await runFinalReadinessChecks({ rootDir, setupPrReconciler: () => null, setupInstallationPreviewBuilder: readySetupPreview });
  const result = await finishSetup({ startAutomation: true }, {
    rootDir,
    workerManager: { start() { throw new Error('worker unavailable'); } },
  });
  assert.equal(result.completed, true);
  assert.equal(result.workersStarted, false);
  assert.match(result.startError, /worker unavailable/);
  assert.equal(loadConfig(repo).setupComplete, true);
  assert.equal(loadRuntime(repo).claimsEnabled, false);
  assert.equal(result.recoverable, true);
});

test('unchecked Finish setup completes configuration but leaves claims paused', async (t) => {
  const { rootDir, repo } = fixture(t);
  await runFinalReadinessChecks({ rootDir, setupPrReconciler: () => null, setupInstallationPreviewBuilder: readySetupPreview });
  const result = await finishSetup({ startAutomation: false }, { rootDir });
  assert.equal(result.setupComplete, true);
  assert.equal(result.claimsEnabled, false);
  assert.equal(result.workersStarted, false);
  assert.equal(loadRuntime(repo).claimsEnabled, false);
});

test('Final readiness uses one consolidated setup checklist and only the footer Finish action', () => {
  assert.match(FINAL_READINESS_SCRIPT, /Final setup check/);
  assert.match(FINAL_READINESS_SCRIPT, /Confirm the saved setup and any repository repair before finishing/);
  assert.doesNotMatch(FINAL_READINESS_SCRIPT, /Approved setup summary/);
  assert.doesNotMatch(FINAL_READINESS_SCRIPT, /Final safe checks/);
  assert.equal((FINAL_READINESS_SCRIPT.match(/class="checklist"/g) || []).length, 1);
  assert.match(FINAL_READINESS_SCRIPT, /pageById/);
  assert.match(FINAL_READINESS_SCRIPT, /Open setup PR/);
  assert.match(FINAL_READINESS_SCRIPT, /font-size:16px;font-weight:650/);
  assert.match(FINAL_READINESS_SCRIPT, /> Start automation after setup<\/label>/);
  assert.doesNotMatch(FINAL_READINESS_SCRIPT, /id="readiness-finish"/);
  assert.match(FINAL_READINESS_SCRIPT, /closest\?\.\('#continue'\)/);
  assert.match(FINAL_READINESS_SCRIPT, /api\('\/api\/setup\/readiness\/finish'/);
  assert.match(FINAL_READINESS_SCRIPT, /querySelector\('#readiness-start'\)/);
});
