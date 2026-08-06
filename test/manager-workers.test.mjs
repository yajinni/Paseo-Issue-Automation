import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerWorkerPool } from '../src/manager-workers.mjs';

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setIntervalFn(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearIntervalFn(timer) { timer.cleared = true; },
  };
}

test('repository workers start once and dispatch only their own roots', () => {
  const timerState = fakeTimers();
  const dispatches = [];
  const updates = [];
  const pool = createManagerWorkerPool({
    dispatch: (root) => {
      dispatches.push(root);
      if (root === '/repo-b') throw new Error('repo-b unavailable');
      return { claimed: false, root };
    },
    updateDispatch: (root, result) => updates.push([root, result]),
    readConfig: (root) => ({ pollIntervalSeconds: root === '/repo-a' ? 60 : 120 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
    now: (() => {
      let tick = 0;
      return () => new Date(`2026-08-06T11:00:0${tick++}.000Z`);
    })(),
  });

  const first = pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  const duplicate = pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  const second = pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });
  assert.equal(first.running, true);
  assert.equal(duplicate.startedAt, first.startedAt);
  assert.equal(second.intervalSeconds, 120);
  assert.equal(timerState.timers.length, 2);
  assert.equal(timerState.timers[0].milliseconds, 60_000);
  assert.equal(timerState.timers[1].milliseconds, 120_000);

  pool.tick('repo-a');
  pool.tick('repo-b');
  assert.deepEqual(dispatches, ['/repo-a', '/repo-b']);
  assert.deepEqual(updates, [['/repo-a', { claimed: false, root: '/repo-a' }]]);
  assert.equal(pool.status('repo-a').lastError, null);
  assert.equal(pool.status('repo-b').lastError, 'repo-b unavailable');
  assert.equal(pool.status('repo-b').running, true);
});

test('stopping, refreshing, and closing workers remain repository isolated', () => {
  const timerState = fakeTimers();
  const intervals = new Map([['/repo-a', 60], ['/repo-b', 90]]);
  const pool = createManagerWorkerPool({
    dispatch: () => ({ claimed: false }),
    updateDispatch: () => {},
    readConfig: (root) => ({ pollIntervalSeconds: intervals.get(root) }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  const repositoryA = { id: 'repo-a', name: 'A', path: '/repo-a' };
  const repositoryB = { id: 'repo-b', name: 'B', path: '/repo-b' };
  pool.start(repositoryA);
  pool.start(repositoryB);
  const firstTimer = timerState.timers[0];
  const secondTimer = timerState.timers[1];

  const stopped = pool.stop('repo-a');
  assert.equal(stopped.changed, true);
  assert.equal(firstTimer.cleared, true);
  assert.equal(secondTimer.cleared, false);
  assert.equal(pool.status('repo-a').running, false);
  assert.equal(pool.status('repo-b').running, true);

  intervals.set('/repo-b', 180);
  const refreshed = pool.refresh(repositoryB);
  assert.equal(secondTimer.cleared, true);
  assert.equal(refreshed.intervalSeconds, 180);
  assert.equal(pool.list().length, 1);

  pool.close();
  assert.equal(pool.list().length, 0);
  assert.equal(timerState.timers.at(-1).cleared, true);
});

test('invalid worker configuration is rejected before a timer starts', () => {
  const timerState = fakeTimers();
  const pool = createManagerWorkerPool({
    readConfig: () => ({ pollIntervalSeconds: 10 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  assert.throws(
    () => pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' }),
    /at least 60/,
  );
  assert.equal(timerState.timers.length, 0);
});
