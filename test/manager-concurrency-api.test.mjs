import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { managerHtml } from '../src/manager-concurrency-ui.mjs';

test('manager config API reads and saves the global coding limit', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-api-config-'));
  let drains = 0;
  const workerManager = {
    drain: () => { drains += 1; },
    managerStatus: () => ({ active: 1, available: 3, runningWorkerCount: 2 }),
    list: () => [{ repositoryId: 'one' }, { repositoryId: 'two' }],
  };

  const initial = managerApiRequest({ method: 'GET', pathname: '/api/manager/config' }, { rootDir, workerManager });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.config.globalMaxActive, 2);

  const saved = managerApiRequest({
    method: 'POST',
    pathname: '/api/manager/config',
    body: { globalMaxActive: 4 },
  }, { rootDir, workerManager });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.config.globalMaxActive, 4);
  assert.equal(saved.body.manager.available, 3);
  assert.equal(drains, 1);

  const status = managerApiRequest({ method: 'GET', pathname: '/api/manager/status' }, { rootDir, workerManager });
  assert.equal(status.status, 200);
  assert.equal(status.body.config.globalMaxActive, 4);
  assert.equal(status.body.workers.length, 2);
});

test('manager config API rejects an invalid global limit', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-api-config-'));
  assert.throws(
    () => managerApiRequest({
      method: 'POST',
      pathname: '/api/manager/config',
      body: { globalMaxActive: 0 },
    }, { rootDir }),
    /1 through 50/,
  );
});

test('manager dashboard exposes global capacity and fairness state', () => {
  const html = managerHtml();
  assert.match(html, /id="global-max-active"/);
  assert.match(html, /Manager-wide coding capacity/);
  assert.match(html, /fair scheduling turn/);
  assert.match(html, /\/api\/manager\/status/);
  assert.match(html, /Capacity wait/);
});
