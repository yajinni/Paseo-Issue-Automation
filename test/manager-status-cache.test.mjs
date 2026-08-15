import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createManagerStatusCache } from '../src/manager-status-cache.mjs';

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('status cache returns immediately while the deep repository probe runs off-thread', async () => {
  const workers = [];
  const cache = createManagerStatusCache({
    refreshIntervalMs: 0,
    workerManager: { status: () => ({ running: true, state: 'idle' }) },
    reviewWorkerManager: { status: () => ({ running: true, state: 'running' }) },
    workerFactory: (data) => {
      const worker = new EventEmitter();
      workers.push(data);
      process.nextTick(() => worker.emit('message', {
        ok: true,
        status: {
          repository: data.repository,
          automation: { activeRunCount: 4 },
          worker: data.workerStatus,
          reviewWorker: data.reviewWorkerStatus,
        },
      }));
      return worker;
    },
  });
  try {
    const repository = { id: 'repo-1', name: 'Example', path: '/repo-1' };
    const pending = cache.read(repository);
    assert.equal(pending.statusRefresh.state, 'refreshing');
    assert.equal(pending.repository.id, 'repo-1');

    await settle();
    const ready = cache.read(repository);
    assert.equal(ready.automation.activeRunCount, 4);
    assert.equal(ready.worker.running, true);
    assert.equal(ready.statusRefresh.state, 'ready');
    assert.equal(workers.length, 1);
  } finally {
    cache.close();
  }
});

test('failed refresh retains last-known-good status and reports a delayed state', async () => {
  let attempt = 0;
  const cache = createManagerStatusCache({
    refreshIntervalMs: 0,
    workerFactory: () => {
      const worker = new EventEmitter();
      process.nextTick(() => {
        attempt += 1;
        if (attempt === 1) worker.emit('message', { ok: true, status: { value: 'known-good' } });
        else worker.emit('error', new Error('simulated status timeout'));
      });
      return worker;
    },
  });
  try {
    const repository = { id: 'repo-2', path: '/repo-2' };
    cache.read(repository);
    await settle();
    cache.refresh(repository);
    await settle();
    const delayed = cache.read(repository);
    assert.equal(delayed.value, 'known-good');
    assert.equal(delayed.statusRefresh.state, 'delayed');
    assert.match(delayed.statusRefresh.error, /simulated status timeout/);
    assert.ok(delayed.statusRefresh.lastSuccessfulAt);
  } finally {
    cache.close();
  }
});

test('status cache shutdown is awaitable, idempotent, and prevents new refresh workers', async () => {
  let factoryCalls = 0;
  let finishTermination;
  const termination = new Promise((resolve) => { finishTermination = resolve; });
  const cache = createManagerStatusCache({
    refreshIntervalMs: 0,
    workerFactory: () => {
      factoryCalls += 1;
      const worker = new EventEmitter();
      worker.terminate = () => termination;
      return worker;
    },
  });
  const repository = { id: 'repo-shutdown', path: '/repo-shutdown' };
  cache.read(repository);

  const firstClose = cache.close();
  assert.equal(firstClose, cache.close());
  cache.refresh({ id: 'repo-after-shutdown', path: '/repo-after-shutdown' });
  assert.equal(factoryCalls, 1);

  let settled = false;
  firstClose.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  finishTermination();
  await firstClose;
  assert.equal(settled, true);
});
