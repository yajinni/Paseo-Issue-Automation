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

function safeCapacityOptions(globalMaxActive = 10) {
  return {
    countActive: () => 0,
    readManagerConfig: () => ({ globalMaxActive }),
  };
}

test('repository workers start once and dispatch only their own roots', () => {
  const timerState = fakeTimers();
  const dispatches = [];
  const updates = [];
  const pool = createManagerWorkerPool({
    ...safeCapacityOptions(),
    dispatch: (root, options) => {
      dispatches.push([root, options]);
      if (root === '/repo-b') throw new Error('repo-b unavailable');
      return { claimed: false, root };
    },
    updateDispatch: (root, result) => updates.push([root, result]),
    readConfig: (root) => ({ pollIntervalSeconds: root === '/repo-a' ? 60 : 120, maxActive: 2 }),
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
  assert.deepEqual(dispatches.map((entry) => entry[0]), ['/repo-a', '/repo-b']);
  assert.ok(dispatches.every((entry) => entry[1].maxClaims === 1));
  assert.deepEqual(updates, [['/repo-a', { claimed: false, root: '/repo-a' }]]);
  assert.equal(pool.status('repo-a').lastError, null);
  assert.equal(pool.status('repo-b').lastError, 'repo-b unavailable');
  assert.equal(pool.status('repo-b').running, true);
});

test('stopping, refreshing, and closing workers remain repository isolated', () => {
  const timerState = fakeTimers();
  const intervals = new Map([['/repo-a', 60], ['/repo-b', 90]]);
  const pool = createManagerWorkerPool({
    ...safeCapacityOptions(),
    dispatch: () => ({ claimed: false }),
    updateDispatch: () => {},
    readConfig: (root) => ({ pollIntervalSeconds: intervals.get(root), maxActive: 2 }),
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

test('global capacity prevents independently timed workers from over-dispatching', () => {
  const timerState = fakeTimers();
  const active = new Map([['/repo-a', 0], ['/repo-b', 0]]);
  const dispatches = [];
  const pool = createManagerWorkerPool({
    dispatch: (root) => {
      dispatches.push(root);
      active.set(root, active.get(root) + 1);
      return { claimed: true, root };
    },
    updateDispatch: () => {},
    countActive: (root) => active.get(root),
    readConfig: () => ({ pollIntervalSeconds: 60, maxActive: 3 }),
    readManagerConfig: () => ({ globalMaxActive: 1 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });
  pool.tick('repo-a');
  pool.tick('repo-b');
  assert.deepEqual(dispatches, ['/repo-a']);
  assert.equal(pool.status('repo-b').pending, true);
  assert.match(pool.status('repo-b').lastScheduleReason, /Global coding capacity reached/);
  assert.equal(pool.managerStatus().active, 1);
  assert.equal(pool.managerStatus().available, 0);
});

test('pending repositories rotate fairly as global slots become available', () => {
  const timerState = fakeTimers();
  const active = new Map([['/repo-a', 0], ['/repo-b', 0]]);
  const dispatches = [];
  const pool = createManagerWorkerPool({
    dispatch: (root) => {
      dispatches.push(root);
      active.set(root, active.get(root) + 1);
      return { claimed: true, root };
    },
    updateDispatch: () => {},
    countActive: (root) => active.get(root),
    readConfig: () => ({ pollIntervalSeconds: 60, maxActive: 3 }),
    readManagerConfig: () => ({ globalMaxActive: 1 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });

  pool.tick('repo-a');
  pool.tick('repo-b');
  active.set('/repo-a', 0);
  pool.tick('repo-a');
  active.set('/repo-b', 0);
  pool.tick('repo-b');

  assert.deepEqual(dispatches, ['/repo-a', '/repo-b', '/repo-a']);
  assert.equal(pool.managerStatus().lastServedRepositoryId, 'repo-a');
});

test('unknown active counts are handled conservatively and surfaced', () => {
  const timerState = fakeTimers();
  const dispatches = [];
  const pool = createManagerWorkerPool({
    dispatch: (root) => { dispatches.push(root); return { claimed: true }; },
    updateDispatch: () => {},
    countActive: (root) => {
      if (root === '/repo-a') throw new Error('GitHub unavailable');
      return 0;
    },
    readConfig: () => ({ pollIntervalSeconds: 60, maxActive: 2 }),
    readManagerConfig: () => ({ globalMaxActive: 2 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });
  pool.tick('repo-b');
  assert.deepEqual(dispatches, []);
  assert.match(pool.status('repo-a').capacityError, /GitHub unavailable/);
  assert.equal(pool.managerStatus().errors.length, 1);
});

test('invalid worker configuration is rejected before a timer starts', () => {
  const timerState = fakeTimers();
  const pool = createManagerWorkerPool({
    ...safeCapacityOptions(),
    readConfig: () => ({ pollIntervalSeconds: 10, maxActive: 1 }),
    setIntervalFn: timerState.setIntervalFn,
    clearIntervalFn: timerState.clearIntervalFn,
  });
  assert.throws(
    () => pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' }),
    /at least 60/,
  );
  assert.equal(timerState.timers.length, 0);
});
