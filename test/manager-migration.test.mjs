import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import {
  migrateEmbeddedRepositoryFromManager,
  reconcileEmbeddedMigrationFromManager,
} from '../src/manager-installation.mjs';
import { managerHtml } from '../src/manager-install-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-manager-migration-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/MigrationExample.git'], { cwd: root });
  return root;
}

test('manager migration allows an idle coding worker but still blocks active coding or a running PR-review worker', () => {
  const entry = { id: 'repo-one', path: '/repo-one' };
  assert.deepEqual(
    migrateEmbeddedRepositoryFromManager(entry, {
      workerManager: { status: () => ({ running: true, state: 'idle', activeCount: 0 }) },
      migrator: () => ({ created: true }),
    }),
    { created: true },
  );
  assert.throws(
    () => migrateEmbeddedRepositoryFromManager(entry, {
      workerManager: { status: () => ({ running: true, state: 'active', activeCount: 1 }) },
      migrator: () => ({ created: true }),
    }),
    /active coding work to finish/,
  );
  assert.throws(
    () => reconcileEmbeddedMigrationFromManager(entry, {
      workerManager: { status: () => ({ running: true, state: 'idle', activeCount: 0 }) },
      reviewWorkerManager: { status: () => ({ running: true }) },
      reconciler: () => ({ completed: true }),
    }),
    /Stop this repository’s PR-review worker/,
  );
});

test('manager migration and reconciliation endpoints remain repository scoped', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-migration-api-'));
  const root = repository();
  const entry = addRepository(root, { rootDir });
  const calls = [];
  const statusReader = (repositoryEntry) => ({ repository: repositoryEntry, refreshed: true });
  const created = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(entry.id)}/migrate/external`,
  }, {
    rootDir,
    migrationHandler: (repositoryEntry, options) => {
      calls.push(['create', repositoryEntry, options]);
      return { created: true, migration: { number: 54 } };
    },
    statusReader,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.migration.number, 54);
  assert.equal(calls[0][1].path, root);
  assert.equal(created.body.status.refreshed, true);

  const reconciled = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(entry.id)}/migrate/reconcile`,
  }, {
    rootDir,
    migrationReconcileHandler: (repositoryEntry) => {
      calls.push(['reconcile', repositoryEntry]);
      return { completed: true };
    },
    statusReader,
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.result.completed, true);
  assert.equal(calls[1][1].id, entry.id);
});

test('manager UI explains reviewed migration and exposes both actions', () => {
  const html = managerHtml();
  assert.match(html, /Create migration PR/);
  assert.match(html, /Reconcile migration PR/);
  assert.match(html, /migrate\/external/);
  assert.match(html, /migrate\/reconcile/);
  assert.match(html, /Wait for coding work to finish/);
  assert.doesNotMatch(html, /Stop repository workers before migration/);
  assert.match(html, /Controller mode changes only after that PR merges/);
});
