import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { installExternalRepositoryFromManager } from '../src/manager-installation.mjs';
import { managerHtml } from '../src/manager-install-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-manager-external-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/ExternalExample.git'], { cwd: root });
  return root;
}

test('manager external installation refuses active repository workers', () => {
  const entry = { id: 'repo-one', path: '/repo-one', name: 'One' };
  assert.throws(
    () => installExternalRepositoryFromManager(entry, {
      workerManager: { status: () => ({ running: true }) },
      reviewWorkerManager: { status: () => ({ running: false }) },
      installer: () => { throw new Error('installer should not run'); },
    }),
    /Stop this repository’s coding worker/,
  );
  assert.throws(
    () => installExternalRepositoryFromManager(entry, {
      workerManager: { status: () => ({ running: false }) },
      reviewWorkerManager: { status: () => ({ running: true }) },
      installer: () => { throw new Error('installer should not run'); },
    }),
    /Stop this repository’s PR-review worker/,
  );
});

test('manager external installation passes only the selected repository path', () => {
  const calls = [];
  const result = installExternalRepositoryFromManager({ id: 'repo-one', path: '/repo-one' }, {
    workerManager: { status: () => ({ running: false }) },
    reviewWorkerManager: { status: () => ({ running: false }) },
    installer: (root) => { calls.push(root); return { controllerMode: 'external-manager' }; },
  });
  assert.deepEqual(calls, ['/repo-one']);
  assert.deepEqual(result, { controllerMode: 'external-manager' });
});

test('repository-scoped API invokes external installation and returns refreshed status', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-external-api-'));
  const root = repository();
  const entry = addRepository(root, { rootDir });
  const calls = [];
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(entry.id)}/install/external`,
  }, {
    rootDir,
    installHandler: (repositoryEntry, options) => {
      calls.push({ repositoryEntry, options });
      return { installed: true };
    },
    statusReader: (repositoryEntry) => ({ repository: repositoryEntry, refreshed: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result, { installed: true });
  assert.equal(response.body.status.refreshed, true);
  assert.equal(calls[0].repositoryEntry.id, entry.id);
  assert.equal(calls[0].repositoryEntry.path, root);
});

test('manager installation UI states that dependency and lockfile changes are not made', () => {
  const html = managerHtml();
  assert.match(html, /Install for standalone manager/);
  assert.match(html, /package\.json/);
  assert.match(html, /lockfile/);
  assert.match(html, /node_modules/);
  assert.match(html, /paseo\.json/);
  assert.match(html, /install\/external/);
  assert.match(html, /Setup PR #/);
});
