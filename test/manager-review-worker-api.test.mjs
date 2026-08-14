import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { loadPrReviewStore } from '../src/pr-review-store.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function fixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-review-worker-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  return { rootDir, repository: addRepository(repositoryRoot, { rootDir }) };
}

function reviewWorkerManager(calls) {
  const running = new Set();
  return {
    start: (entry) => {
      calls.push(['start', entry.id]);
      running.add(entry.id);
      return { repositoryId: entry.id, running: true, state: 'running' };
    },
    stop: (id) => {
      calls.push(['stop', id]);
      const changed = running.delete(id);
      return { repositoryId: id, running: false, state: 'stopped', changed };
    },
    restart: (entry) => {
      calls.push(['restart', entry.id]);
      running.add(entry.id);
      return { repositoryId: entry.id, running: true, state: 'running' };
    },
    status: (id) => ({ repositoryId: id, running: running.has(id), state: running.has(id) ? 'running' : 'stopped' }),
  };
}

function request(rootDir, repository, action, { body = {}, ...options } = {}) {
  return managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/${action}`,
    body,
  }, {
    rootDir,
    statusReader: () => ({}),
    ...options,
  });
}

function paused(repository) {
  return loadPrReviewStore(repository.path).config.reviewQueue.paused;
}

test('authoritative PR-review resume persists running and starts the worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const response = request(rootDir, repository, 'pr-review/resume', { reviewWorkerManager: reviewWorkerManager(calls) });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.state, 'running');
  assert.equal(paused(repository), false);
  assert.deepEqual(calls, [['start', repository.id]]);
});

test('authoritative PR-review pause persists stopped and stops the worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const manager = reviewWorkerManager(calls);
  request(rootDir, repository, 'pr-review/resume', { reviewWorkerManager: manager });
  calls.length = 0;

  const response = request(rootDir, repository, 'pr-review/pause', { reviewWorkerManager: manager });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.state, 'stopped');
  assert.equal(paused(repository), true);
  assert.deepEqual(calls, [['stop', repository.id]]);
});

test('legacy PR-review start is retired and cannot start a stopped worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const response = request(rootDir, repository, 'review-worker/start', { reviewWorkerManager: reviewWorkerManager(calls) });

  assert.equal(response.status, 410);
  assert.match(response.body.error, /\/api\/pr-review\/resume/);
  assert.equal(paused(repository), true);
  assert.deepEqual(calls, []);
});

test('legacy PR-review stop is retired and cannot stop a running worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const manager = reviewWorkerManager(calls);
  request(rootDir, repository, 'pr-review/resume', { reviewWorkerManager: manager });
  calls.length = 0;

  const response = request(rootDir, repository, 'review-worker/stop', { reviewWorkerManager: manager });

  assert.equal(response.status, 410);
  assert.match(response.body.error, /\/api\/pr-review\/pause/);
  assert.equal(paused(repository), false);
  assert.deepEqual(calls, []);
});

test('legacy PR-review restart does not start a stopped worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const response = request(rootDir, repository, 'review-worker/restart', { reviewWorkerManager: reviewWorkerManager(calls) });

  assert.equal(response.status, 202);
  assert.equal(response.body.result.running, false);
  assert.equal(paused(repository), true);
  assert.deepEqual(calls, [['stop', repository.id]]);
});

test('legacy PR-review restart preserves persisted running state while restarting the worker', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const manager = reviewWorkerManager(calls);
  request(rootDir, repository, 'pr-review/resume', { reviewWorkerManager: manager });
  calls.length = 0;

  const response = request(rootDir, repository, 'review-worker/restart', { reviewWorkerManager: manager });

  assert.equal(response.status, 202);
  assert.equal(response.body.result.running, true);
  assert.equal(response.body.status, undefined);
  assert.equal(paused(repository), false);
  assert.deepEqual(calls, [['restart', repository.id]]);
});

test('repository configuration saves do not start or stop PR-review workers', () => {
  const { rootDir, repository } = fixture();
  const calls = [];
  const response = request(rootDir, repository, 'config', {
    body: { baseBranch: 'main' },
    reviewWorkerManager: reviewWorkerManager(calls),
  });

  assert.equal(response.status, 200);
  assert.equal(paused(repository), true);
  assert.deepEqual(calls, []);
});
