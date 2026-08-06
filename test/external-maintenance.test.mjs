import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CONTROLLER_MODES,
  clearControllerMode,
  loadControllerMode,
  saveControllerMode,
} from '../src/controller-mode.mjs';
import { saveExternalMaintenance } from '../src/external-maintenance.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import {
  reconcileExternalRemovalFromManager,
  removeExternalRepositoryFromManager,
  repairExternalRepositoryFromManager,
} from '../src/manager-installation.mjs';
import { managerHtml } from '../src/manager-maintenance-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { deriveManagedRepositoryBlockers } from '../src/repository-health.mjs';

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-external-maintenance-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/MaintenanceExample.git'], { cwd: root });
  return root;
}

test('completed removal clears inferred mode while a later explicit reinstall wins', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-controller-mode-removal-'));
  saveControllerMode(root, CONTROLLER_MODES.external);
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.external);
  clearControllerMode(root);
  saveExternalMaintenance(root, { removal: { state: 'completed', number: 12 } });
  assert.equal(loadControllerMode(root), null);
  saveControllerMode(root, CONTROLLER_MODES.external);
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.external);
});

test('external maintenance refuses active workers and scopes handlers to one path', () => {
  const entry = { id: 'repo-one', path: '/repo-one', name: 'One' };
  const activeCoding = {
    workerManager: { status: () => ({ running: true }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
  };
  assert.throws(
    () => repairExternalRepositoryFromManager(entry, { ...activeCoding, repairer: () => null }),
    /Stop this repository’s coding worker/,
  );
  const activeReview = {
    workerManager: { status: () => ({ running: false }) },
    reviewWorkerManager: { status: () => ({ running: true }) },
  };
  assert.throws(
    () => removeExternalRepositoryFromManager(entry, { ...activeReview, remover: () => null }),
    /Stop this repository’s PR-review worker/,
  );
  const calls = [];
  const stopped = {
    workerManager: { status: () => ({ running: false }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
  };
  repairExternalRepositoryFromManager(entry, { ...stopped, repairer: (root) => calls.push(['repair', root]) });
  removeExternalRepositoryFromManager(entry, { ...stopped, remover: (root) => calls.push(['remove', root]) });
  reconcileExternalRemovalFromManager(entry, { ...stopped, reconciler: (root) => calls.push(['reconcile', root]) });
  assert.deepEqual(calls, [
    ['repair', '/repo-one'],
    ['remove', '/repo-one'],
    ['reconcile', '/repo-one'],
  ]);
});

test('maintenance API routes remain repository scoped and return refreshed status', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-maintenance-api-'));
  const root = repository();
  const entry = addRepository(root, { rootDir });
  const routes = [
    ['maintenance/repair', 'repairHandler'],
    ['maintenance/remove', 'removalHandler'],
    ['maintenance/reconcile', 'removalReconcileHandler'],
  ];
  for (const [route, key] of routes) {
    const calls = [];
    const response = managerApiRequest({
      method: 'POST',
      pathname: `/api/repositories/${encodeURIComponent(entry.id)}/${route}`,
    }, {
      rootDir,
      [key]: (repositoryEntry) => {
        calls.push(repositoryEntry.path);
        return { route };
      },
      statusReader: (repositoryEntry) => ({ repository: repositoryEntry, refreshed: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.result, { route });
    assert.equal(response.body.status.refreshed, true);
    assert.deepEqual(calls, [root]);
  }
});

test('removal blockers name the exact PR and recovery action', () => {
  const status = {
    repository: { repository: 'yajinni/Example' },
    setup: { complete: false, controllerMode: 'external-manager', repositoryChanges: {} },
    maintenance: {
      removal: {
        number: 88,
        url: 'https://github.com/yajinni/Example/pull/88',
        state: 'merged',
        syncedAt: null,
        syncError: 'working tree is dirty',
      },
    },
    automation: { claimsEnabled: false },
    capabilities: {},
  };
  const blocker = deriveManagedRepositoryBlockers(status)[0];
  assert.equal(blocker.code, 'external-removal-sync-pending');
  assert.match(blocker.message, /Removal PR #88/);
  assert.match(blocker.message, /working tree is dirty/);
  assert.deepEqual(blocker.action, {
    kind: 'post',
    label: 'Retry removal synchronization',
    endpoint: 'maintenance/reconcile',
  });
});

test('manager dashboard exposes health, repair, reviewed removal, and reconciliation', () => {
  const html = managerHtml();
  assert.match(html, /Repository health/);
  assert.match(html, /Repair managed components/);
  assert.match(html, /Create removal PR/);
  assert.match(html, /maintenance\/repair/);
  assert.match(html, /maintenance\/remove/);
  assert.match(html, /maintenance\/reconcile/);
  assert.match(html, /manager-owned labels and the Paseo workspace only after merge/);
});

test('syntax validation discovers modules instead of maintaining a manual source list', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const checker = readFileSync(new URL('../scripts/check-syntax.mjs', import.meta.url), 'utf8');
  assert.equal(packageJson.scripts.check, 'node scripts/check-syntax.mjs');
  assert.match(checker, /modules\('src'\)/);
  assert.match(checker, /--check/);
});
