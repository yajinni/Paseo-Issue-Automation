import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  cachedDashboardRemoteState,
  clearDashboardStatusCache,
  requestDashboardStatusRefresh,
} from '../src/dashboard-status-cache.mjs';

class FakeWorker extends EventEmitter {
  constructor(onPost) {
    super();
    this.onPost = onPost;
    this.terminated = false;
  }
  postMessage(input) { this.onPost(this, input); }
  terminate() { this.terminated = true; return Promise.resolve(); }
}

function factory(onPost, counter) {
  return () => {
    counter.count += 1;
    return new FakeWorker(onPost);
  };
}

test('cold cache returns immediately while one worker refresh is shared', async () => {
  clearDashboardStatusCache();
  const counter = { count: 0 };
  let release;
  const workerFactory = factory((worker) => {
    release = () => worker.emit('message', { ok: true, result: { repository: { available: true, issues: [] } } });
  }, counter);

  const first = cachedDashboardRemoteState('/repo', { attempts: [] }, { workerFactory });
  assert.equal(first.remote, null);
  assert.equal(first.statusMeta.state, 'refreshing');

  const pendingA = requestDashboardStatusRefresh('/repo', { attempts: [] }, { workerFactory });
  const pendingB = requestDashboardStatusRefresh('/repo', { attempts: [] }, { workerFactory });
  assert.equal(pendingA, pendingB);
  assert.equal(counter.count, 1);
  release();
  await pendingA;

  const settled = cachedDashboardRemoteState('/repo', { attempts: [] }, { workerFactory });
  assert.equal(settled.remote.repository.available, true);
  assert.equal(settled.statusMeta.state, 'fresh');
});

test('failed refresh keeps the last successful remote snapshot', async () => {
  clearDashboardStatusCache();
  const successCounter = { count: 0 };
  await requestDashboardStatusRefresh('/repo', { attempts: [] }, {
    workerFactory: factory((worker) => worker.emit('message', {
      ok: true,
      result: { repository: { available: true, issues: [{ number: 1 }] } },
    }), successCounter),
  });

  const failureCounter = { count: 0 };
  await requestDashboardStatusRefresh('/repo', { attempts: [] }, {
    workerFactory: factory((worker) => worker.emit('message', { ok: false, error: 'GitHub timed out' }), failureCounter),
  });

  const state = cachedDashboardRemoteState('/repo', { attempts: [] }, {
    workerFactory: () => { throw new Error('unexpected refresh'); },
  });
  assert.equal(state.remote.repository.issues[0].number, 1);
  assert.equal(state.statusMeta.state, 'stale');
  assert.match(state.statusMeta.lastError, /GitHub timed out/);
});
