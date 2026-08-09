import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerWorkerPool } from '../src/manager-workers.mjs';

function fakeTimers() {
  return {
    setIntervalFn(callback, milliseconds) { return { callback, milliseconds, unref() {} }; },
    clearIntervalFn() {},
  };
}

test('coding worker reports Idle while available and Active only while coding work exists', () => {
  let active = 0;
  const timers = fakeTimers();
  const pool = createManagerWorkerPool({
    dispatch: () => { active = 1; return { claimed: true, issueNumber: 12 }; },
    updateDispatch: () => {},
    countActive: () => active,
    readConfig: () => ({ pollIntervalSeconds: 60, maxActive: 2 }),
    readManagerConfig: () => ({ globalMaxActive: 2 }),
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });
  const repository = { id: 'repo-a', name: 'A', path: '/repo-a' };
  const started = pool.start(repository);
  assert.equal(started.running, true);
  assert.equal(started.state, 'idle');

  pool.tick(repository.id);
  assert.equal(pool.status(repository.id).state, 'active');
  assert.equal(pool.status(repository.id).activeCount, 1);

  active = 0;
  assert.equal(pool.status(repository.id).state, 'idle');
});

test('refresh starts an absent worker and only restarts when its polling interval changes', () => {
  const timers = [];
  let interval = 60;
  const pool = createManagerWorkerPool({
    dispatch: () => ({ claimed: false }),
    updateDispatch: () => {},
    countActive: () => 0,
    readConfig: () => ({ pollIntervalSeconds: interval, maxActive: 1 }),
    readManagerConfig: () => ({ globalMaxActive: 1 }),
    setIntervalFn(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearIntervalFn(timer) { timer.cleared = true; },
  });
  const repository = { id: 'repo-a', name: 'A', path: '/repo-a' };
  assert.equal(pool.refresh(repository).state, 'idle');
  assert.equal(timers.length, 1);
  pool.refresh(repository);
  assert.equal(timers.length, 1);
  interval = 120;
  assert.equal(pool.refresh(repository).intervalSeconds, 120);
  assert.equal(timers.length, 2);
  assert.equal(timers[0].cleared, true);
});
