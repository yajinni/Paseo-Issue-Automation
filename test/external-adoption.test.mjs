import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONTROLLER_MODES, loadControllerMode } from '../src/controller-mode.mjs';
import {
  adoptAlreadyMigratedRepository,
  inspectExternalMigrationAdoption,
} from '../src/external-adoption.mjs';
import { loadExternalMigration } from '../src/external-migration.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import { finalizeExistingMigrationFromManager } from '../src/manager-installation.mjs';
import { managerHtml } from '../src/manager-maintenance-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { deriveManagedRepositoryBlockers } from '../src/repository-health.mjs';
import { saveSetupPullRequest } from '../src/setup-pr.mjs';
import {
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  saveRuntime,
  statePaths,
} from '../src/state.mjs';

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-external-adoption-'));
  execFileSync('git', ['init', '-b', 'rewrite/openspec-baseline'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Paseo Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'paseo@example.test'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/JuliesDashboard.git'], { cwd: root });
  writeJson(path.join(root, 'package.json'), {
    name: 'juliesdashboard',
    private: true,
    devDependencies: { vite: '^8.0.16' },
  });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'juliesdashboard',
    lockfileVersion: 3,
    packages: { '': { name: 'juliesdashboard', devDependencies: { vite: '^8.0.16' } } },
  });
  writeJson(path.join(root, 'paseo.json'), {
    worktree: { setup: 'node setup.mjs', teardown: 'node teardown.mjs' },
    scripts: { check: { command: 'npm run check' }, test: { command: 'npm test' } },
  });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'Already migrated repository'], { cwd: root, stdio: 'ignore' });
  saveConfig(root, {
    ...loadConfig(root),
    baseBranch: 'rewrite/openspec-baseline',
    setupComplete: false,
    models: { coder: 'opencode/coder', reviewer: 'opencode/reviewer' },
    workspace: { id: 'workspace-julie', title: 'Paseo Issue Automation' },
  });
  saveRuntime(root, {
    ...loadRuntime(root),
    claimsEnabled: false,
    skippedIssueNumbers: [274],
  });
  saveIntegration(root, {
    ...loadIntegration(root),
    issueTemplate: { createdByPackage: true, path: '.github/ISSUE_TEMPLATE/automated-coding-task.md' },
    labels: { 'agent-ready': { createdByPackage: true } },
    workspace: { createdByPackage: true, id: 'workspace-julie' },
    paseoJson: { serviceAddedByPackage: true, createdByPackage: false, path: 'paseo.json' },
  });
  saveSetupPullRequest(root, {
    number: 379,
    url: 'https://github.com/yajinni/JuliesDashboard/pull/379',
    state: 'open',
    files: ['package-lock.json'],
  });
  return root;
}

test('Julie post-migration state is recognized without creating another migration PR', () => {
  const root = repository();
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.embedded);
  const inspection = inspectExternalMigrationAdoption(root);
  assert.equal(inspection.ready, true);
  assert.equal(inspection.activeIssuesChecked, false);
  assert.equal(inspection.dependency, null);
  assert.deepEqual(inspection.lockfiles, []);
  assert.equal(inspection.service.state, 'absent');
  assert.equal(inspection.setupPullRequest.number, 379);
});

test('adoption preserves repository state and supersedes the closed setup record', () => {
  const root = repository();
  const beforeIntegration = loadIntegration(root);
  const beforeConfig = loadConfig(root);
  const result = adoptAlreadyMigratedRepository(root, {
    now: new Date('2026-08-06T13:30:00.000Z'),
    activeIssuesReader: () => [],
    setupReconciler: () => ({
      number: 379,
      url: 'https://github.com/yajinni/JuliesDashboard/pull/379',
      state: 'closed',
      files: ['package-lock.json'],
    }),
  });

  assert.equal(result.adopted, true);
  assert.equal(result.inspection.activeIssuesChecked, true);
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.external);
  const integration = loadIntegration(root);
  assert.equal(integration.paseoJson, null);
  assert.deepEqual(integration.issueTemplate, beforeIntegration.issueTemplate);
  assert.deepEqual(integration.labels, beforeIntegration.labels);
  assert.deepEqual(integration.workspace, beforeIntegration.workspace);
  const config = loadConfig(root);
  assert.equal(config.baseBranch, beforeConfig.baseBranch);
  assert.deepEqual(config.models, beforeConfig.models);
  assert.deepEqual(config.workspace, beforeConfig.workspace);
  assert.equal(config.setupComplete, false);
  assert.deepEqual(loadRuntime(root).skippedIssueNumbers, [274]);
  assert.equal(loadRuntime(root).claimsEnabled, false);
  const migration = loadExternalMigration(root);
  assert.equal(migration.state, 'completed');
  assert.equal(migration.source, 'existing-repository-state');
  assert.equal(migration.supersededSetupPullRequest.number, 379);
  assert.equal(
    existsSync(path.join(statePaths(root).root, 'setup-pull-request.json')),
    false,
  );
});

test('adoption fails closed when embedded files, active issues, or unsafe local state remain', () => {
  const dependencyRoot = repository();
  const manifest = JSON.parse(readFileSync(path.join(dependencyRoot, 'package.json'), 'utf8'));
  manifest.dependencies = { 'paseo-issue-automation': 'github:yajinni/Paseo-Issue-Automation' };
  writeJson(path.join(dependencyRoot, 'package.json'), manifest);
  assert.match(inspectExternalMigrationAdoption(dependencyRoot).reasons.join(' '), /still declared/);

  const serviceRoot = repository();
  const paseo = JSON.parse(readFileSync(path.join(serviceRoot, 'paseo.json'), 'utf8'));
  paseo.scripts['issue-coding-automation'] = {
    type: 'service',
    command: 'npx --no-install paseo-issue-automation start',
  };
  writeJson(path.join(serviceRoot, 'paseo.json'), paseo);
  assert.match(inspectExternalMigrationAdoption(serviceRoot).reasons.join(' '), /service is still present/);

  const changedRoot = repository();
  writeFileSync(path.join(changedRoot, 'notes.txt'), 'uncommitted\n');
  assert.match(inspectExternalMigrationAdoption(changedRoot).reasons.join(' '), /clean working tree/);

  const activeRoot = repository();
  assert.throws(
    () => adoptAlreadyMigratedRepository(activeRoot, {
      activeIssuesReader: () => [{ issueNumber: 274 }],
      setupReconciler: () => ({ number: 379, state: 'closed' }),
    }),
    /Stop active automation issues.*#274/,
  );
  assert.equal(loadControllerMode(activeRoot), CONTROLLER_MODES.embedded);
});

test('manager finalization allows an idle coding worker but refuses active coding and refreshes setup readiness', () => {
  const repositoryEntry = { id: 'julie', path: '/julie', name: 'Julie' };
  assert.throws(
    () => finalizeExistingMigrationFromManager(repositoryEntry, {
      workerManager: { status: () => ({ running: true, state: 'active', activeCount: 1 }) },
      reviewWorkerManager: { status: () => ({ running: false }) },
      adopter: () => ({ adopted: true }),
      refresher: () => ({ checks: { ready: true }, config: { setupComplete: true } }),
    }),
    /active coding work to finish/,
  );

  const calls = [];
  const result = finalizeExistingMigrationFromManager(repositoryEntry, {
    workerManager: { status: () => ({ running: true, state: 'idle', activeCount: 0 }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
    adopter: (root) => { calls.push(['adopt', root]); return { adopted: true }; },
    refresher: (root, options) => {
      calls.push(['refresh', root, options]);
      return { checks: { ready: true }, config: { setupComplete: true } };
    },
  });
  assert.equal(result.setupReady, true);
  assert.equal(result.setupComplete, true);
  assert.equal(calls[0][1], '/julie');
  assert.equal(calls[1][1], '/julie');
  assert.equal(calls[1][2].forceIntegration, true);
});

test('adoption API remains scoped to the selected registered repository', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-adoption-api-'));
  const root = repository();
  const entry = addRepository(root, { rootDir });
  const calls = [];
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(entry.id)}/migrate/adopt`,
  }, {
    rootDir,
    adoptionHandler: (selectedRoot) => { calls.push(['adopt', selectedRoot]); return { adopted: true }; },
    setupRefresher: (selectedRoot) => {
      calls.push(['refresh', selectedRoot]);
      return { checks: { ready: true }, config: { setupComplete: true } };
    },
    statusReader: (repositoryEntry) => ({ repository: repositoryEntry, refreshed: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.result.adopted, true);
  assert.equal(response.body.result.setupReady, true);
  assert.equal(response.body.status.refreshed, true);
  assert.deepEqual(calls.map((item) => item[1]), [root, root]);
});

test('dashboard and blocker direct already-migrated repositories to finalization', () => {
  const blockers = deriveManagedRepositoryBlockers({
    repository: { repository: 'yajinni/JuliesDashboard' },
    setup: {
      complete: false,
      controllerMode: CONTROLLER_MODES.embedded,
      embeddedController: true,
      migrationAdoption: { ready: true, setupPullRequest: { number: 379 } },
      repositoryChanges: {},
    },
    automation: { claimsEnabled: false },
    capabilities: { migrationAdoption: true },
  });
  assert.equal(blockers[0].code, 'external-migration-adoption-ready');
  assert.match(blockers[0].message, /no longer contains the embedded package dependency or service/);
  assert.equal(blockers[0].action.targetId, 'finalize-existing-migration');
  assert.equal(blockers.some((item) => item.code === 'setup-incomplete'), false);

  const html = managerHtml();
  assert.match(html, /Finalize existing migration/);
  assert.match(html, /migrate\/adopt/);
  assert.match(html, /another reviewed PR/);
});
