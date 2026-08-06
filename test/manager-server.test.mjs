import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import { managerHtml } from '../src/manager-worker-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { loadConfig, saveConfig, saveRuntime } from '../src/state.mjs';

function createRepository(parent, name) {
  const root = path.join(parent, name);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:yajinni/${name}.git`], { cwd: root });
  return root;
}

test('manager command starts outside a repository without invoking legacy dispatch', async () => {
  const calls = [];
  const result = await dispatchCli(['manager', '--open'], {
    cwd: tmpdir(),
    rootDir: '/manager-home',
    managerCommand: async (options) => { calls.push(options); return { started: true }; },
    mainCommand: async () => { throw new Error('legacy command should not run'); },
  });
  assert.deepEqual(result, { started: true });
  assert.deepEqual(calls, [{ open: true, rootDir: '/manager-home' }]);
  await assert.rejects(
    dispatchCli(['manager', '--unknown'], { managerCommand: async () => null }),
    /Unknown manager option/,
  );
});

test('manager API returns isolated repository state and scopes actions and workers', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-api-'));
  const repositoryRoot = createRepository(rootDir, 'Example');
  const repository = addRepository(repositoryRoot, { rootDir });
  const current = loadConfig(repositoryRoot);
  saveConfig(repositoryRoot, {
    ...current,
    setupComplete: true,
    baseBranch: 'main',
    maxActive: 2,
    models: { ...current.models, coder: 'opencode/example-coder', reviewer: 'opencode/example-reviewer' },
  });
  saveRuntime(repositoryRoot, {
    claimsEnabled: true,
    lastDispatchAt: '2026-08-06T10:00:00.000Z',
    lastDispatchResult: { claimed: false, reason: 'No eligible issues.' },
    skippedIssueNumbers: [9],
  });

  const workerCalls = [];
  const workerManager = {
    status: (id) => ({ repositoryId: id, running: true, state: 'running', intervalSeconds: 120 }),
    start: (entry) => { workerCalls.push(['start', entry.id, entry.path]); return { running: true }; },
    stop: (id) => { workerCalls.push(['stop', id]); return { running: false }; },
    restart: (entry) => { workerCalls.push(['restart', entry.id]); return { running: true }; },
    refresh: (entry) => { workerCalls.push(['refresh', entry.id]); return { running: true }; },
    list: () => [],
  };
  const response = managerApiRequest({
    method: 'GET',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/status`,
  }, { rootDir, workerManager });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.repository.id, repository.id);
  assert.equal(response.body.status.repository.repository, 'yajinni/Example');
  assert.equal(response.body.status.setup.complete, true);
  assert.equal(response.body.status.automation.claimsEnabled, true);
  assert.equal(response.body.status.automation.maxActive, 2);
  assert.equal(response.body.status.models.coder, 'opencode/example-coder');
  assert.equal(response.body.status.capabilities.automationActions, true);
  assert.equal(response.body.status.capabilities.backgroundWorkers, true);
  assert.equal(response.body.status.worker.running, true);

  const workerStart = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/worker/start`,
  }, { rootDir, workerManager });
  assert.equal(workerStart.status, 200);
  assert.deepEqual(workerCalls[0], ['start', repository.id, repositoryRoot]);

  const calls = [];
  const mutation = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/pause`,
  }, {
    rootDir,
    workerManager,
    actionHandler: (root, pathname, body) => {
      calls.push({ root, pathname, body });
      return { claimsEnabled: false };
    },
    statusReader: (entry) => ({ repository: entry, refreshed: true }),
  });
  assert.equal(mutation.status, 200);
  assert.deepEqual(calls, [{ root: repositoryRoot, pathname: '/api/pause', body: {} }]);
  assert.deepEqual(mutation.body.result, { claimsEnabled: false });
  assert.equal(mutation.body.status.refreshed, true);

  const removed = managerApiRequest({
    method: 'DELETE',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}`,
  }, { rootDir, workerManager });
  assert.equal(removed.status, 200);
  assert.ok(workerCalls.some((entry) => entry[0] === 'stop' && entry[1] === repository.id));
});

test('manager UI exposes repository selection, scoped controls, and workers', () => {
  const html = managerHtml();
  assert.match(html, /id="repository-select"/);
  assert.match(html, /Register repository/);
  assert.match(html, /Resume claims/);
  assert.match(html, /data-action="worker\/start"/);
  assert.match(html, /data-action="worker\/stop"/);
  assert.match(html, /data-issue-action="start-issue"/);
  assert.match(html, /PR-review workers, global concurrency/);
  assert.match(html, /\/api\/repositories\//);
});
