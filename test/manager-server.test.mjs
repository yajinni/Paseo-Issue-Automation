import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import { managerHtml } from '../src/manager-review-ui.mjs';
import { startConfiguredCodingWorkers, startConfiguredReviewWorkers } from '../src/manager-server.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { loadConfig, saveConfig, saveRuntime } from '../src/state.mjs';

function createRepository(parent, name) {
  const root = path.join(parent, name);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:yajinni/${name}.git`], { cwd: root });
  return root;
}

test('bare command starts the manager outside a repository without invoking legacy dispatch', async () => {
  const calls = [];
  const result = await dispatchCli([], {
    cwd: tmpdir(),
    rootDir: '/manager-home',
    managerCommand: async (options) => { calls.push(options); return { started: true }; },
    mainCommand: async () => { throw new Error('legacy command should not run'); },
  });
  assert.deepEqual(result, { started: true });
  assert.deepEqual(calls, [{ open: true, rootDir: '/manager-home' }]);
});

test('configured repositories automatically start coding workers while incomplete repositories are skipped', () => {
  const calls = [];
  const repositories = [
    { id: 'ready', path: '/ready', repository: 'yajinni/Ready' },
    { id: 'setup', path: '/setup', repository: 'yajinni/Setup' },
  ];
  const result = startConfiguredCodingWorkers({
    start(repository) { calls.push(repository.id); return { repositoryId: repository.id, running: true, state: 'idle' }; },
  }, {
    rootDir: '/manager',
    repositoryLister: () => repositories,
    configLoader: (root) => ({ setupComplete: root === '/ready' }),
  });
  assert.deepEqual(calls, ['ready']);
  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].state, 'idle');
  assert.deepEqual(result.errors, []);
});

test('configured review workers restore only the persisted running lifecycle state', () => {
  const calls = [];
  const repositories = [
    { id: 'running', path: '/running', repository: 'yajinni/Running' },
    { id: 'stopped', path: '/stopped', repository: 'yajinni/Stopped' },
  ];
  const result = startConfiguredReviewWorkers({
    start(repository) { calls.push(repository.id); return { repositoryId: repository.id, running: true }; },
  }, {
    rootDir: '/manager',
    repositoryLister: () => repositories,
    configLoader: () => ({ setupComplete: true }),
    reviewStoreLoader: (root) => ({ config: { reviewQueue: { paused: root === '/stopped' } } }),
  });
  assert.deepEqual(calls, ['running']);
  assert.equal(result.started.length, 1);
  assert.deepEqual(result.errors, []);
});

test('configured review workers restore legacy enabled state when no queue state was persisted', () => {
  const calls = [];
  const result = startConfiguredReviewWorkers({
    start(repository) { calls.push(repository.id); return { repositoryId: repository.id, running: true }; },
  }, {
    rootDir: '/manager',
    repositoryLister: () => [{ id: 'legacy', path: '/legacy' }],
    configLoader: () => ({ setupComplete: true }),
    reviewStoreLoader: () => ({ config: { enabled: true, browserReview: { enabled: true } } }),
  });
  assert.deepEqual(calls, ['legacy']);
  assert.equal(result.started.length, 1);
});

test('manager API keeps coding worker lifecycle internal while PR review worker controls remain repository scoped', () => {
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
    status: (id) => ({ repositoryId: id, running: true, state: 'idle', intervalSeconds: 120 }),
    start: (entry) => { workerCalls.push(['start', entry.id, entry.path]); return { running: true, state: 'idle' }; },
    stop: (id) => { workerCalls.push(['stop', id]); return { running: false, state: 'idle' }; },
    restart: (entry) => { workerCalls.push(['restart', entry.id]); return { running: true, state: 'idle' }; },
    refresh: (entry) => { workerCalls.push(['refresh', entry.id]); return { running: true, state: 'idle' }; },
    list: () => [],
  };
  const reviewCalls = [];
  const reviewWorkerManager = {
    status: (id) => ({ repositoryId: id, running: true, state: 'running', reviewIntervalMs: 5_000 }),
    start: (entry) => { reviewCalls.push(['start', entry.id, entry.path]); return { running: true }; },
    stop: (id) => { reviewCalls.push(['stop', id]); return { running: false }; },
    restart: (entry) => { reviewCalls.push(['restart', entry.id]); return { running: true }; },
    list: () => [],
  };
  const response = managerApiRequest({
    method: 'GET',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/status`,
  }, { rootDir, workerManager, reviewWorkerManager });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.repository.id, repository.id);
  assert.equal(response.body.status.repository.repository, 'yajinni/Example');
  assert.equal(response.body.status.setup.complete, true);
  assert.equal(response.body.status.automation.claimsEnabled, true);
  assert.equal(response.body.status.automation.maxActive, 2);
  assert.equal(response.body.status.models.coder, 'opencode/example-coder');
  assert.equal(response.body.status.capabilities.backgroundWorkers, true);
  assert.equal(response.body.status.capabilities.prReviewWorkers, true);
  assert.equal(response.body.status.worker.running, true);
  assert.equal(response.body.status.worker.state, 'idle');
  assert.equal(response.body.status.reviewWorker.running, true);

  const workerStart = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/worker/start`,
  }, { rootDir, workerManager, reviewWorkerManager });
  assert.equal(workerStart.status, 405);
  assert.equal(workerCalls.some((entry) => entry[0] === 'start'), false);

  const reviewStart = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/review-worker/start`,
  }, { rootDir, workerManager, reviewWorkerManager });
  assert.equal(reviewStart.status, 202);
  assert.equal(reviewStart.body.result.running, true);
  assert.equal(reviewStart.body.status, undefined);
  assert.deepEqual(reviewCalls[0], ['start', repository.id, repositoryRoot]);

  const calls = [];
  const mutation = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/pause`,
  }, {
    rootDir,
    workerManager,
    reviewWorkerManager,
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
  }, { rootDir, workerManager, reviewWorkerManager });
  assert.equal(removed.status, 200);
  assert.ok(workerCalls.some((entry) => entry[0] === 'stop' && entry[1] === repository.id));
  assert.ok(reviewCalls.some((entry) => entry[0] === 'stop' && entry[1] === repository.id));
});

test('manager UI exposes coding status without coding lifecycle controls and leaves PR review controls unchanged', () => {
  const html = managerHtml();
  assert.match(html, /id="repository-select"/);
  assert.match(html, /Register repository/);
  assert.match(html, /Resume claims/);
  assert.match(html, /\['Coding worker', data\.worker && data\.worker\.state === 'active' \? 'Active' : 'Idle'\]/);
  assert.doesNotMatch(html, /data-action="worker\/start"/);
  assert.doesNotMatch(html, /data-action="worker\/stop"/);
  assert.doesNotMatch(html, /data-action="worker\/restart"/);
  assert.doesNotMatch(html, /data-action="review-worker\/(start|stop|restart)"/);
  assert.match(html, /data-issue-action="start-issue"/);
  assert.match(html, /machine-global serial browser lease/);
  assert.match(html, /\/api\/repositories\//);
});
