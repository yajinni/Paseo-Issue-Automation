import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerReviewWorkerPool } from '../src/manager-review-workers.mjs';

function fakeTimers() {
  const intervals = [];
  const timeouts = [];
  return {
    intervals,
    timeouts,
    setIntervalFn(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false, unref() {} };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn(timer) { timer.cleared = true; },
    setTimeoutFn(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false, unref() {} };
      timeouts.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) { timer.cleared = true; },
  };
}

test('PR review workers start independently and recover only their repository roots', () => {
  const timers = fakeTimers();
  const recovered = [];
  const pool = createManagerReviewWorkerPool({
    recover: (root) => { recovered.push(root); return { recovered: root }; },
    loadStore: () => ({
      config: { reconciliation: { enabled: true, activeIntervalMs: 45_000, idleIntervalMs: 300_000 } },
      managedPullRequests: [],
    }),
    reconciliationDelayForStore: () => 300_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const first = pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  const duplicate = pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  const second = pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });
  assert.equal(first.running, true);
  assert.equal(duplicate.startedAt, first.startedAt);
  assert.equal(second.running, true);
  assert.deepEqual(recovered, ['/repo-a', '/repo-b']);
  assert.equal(timers.intervals.length, 2);
  assert.ok(timers.intervals.every((timer) => timer.milliseconds === 5_000));
  assert.equal(timers.timeouts.length, 2);
  assert.ok(timers.timeouts.every((timer) => timer.milliseconds === 300_000));
});

test('review scheduler and reconciliation failures remain repository isolated', () => {
  const timers = fakeTimers();
  const reviewRoots = [];
  const reconcileRoots = [];
  const pool = createManagerReviewWorkerPool({
    reviewTick: (root) => {
      reviewRoots.push(root);
      if (root === '/repo-b') throw new Error('review failed');
      return { started: false, reason: 'none due' };
    },
    reconcile: (root) => {
      reconcileRoots.push(root);
      if (root === '/repo-b') throw new Error('reconcile failed');
      return { checked: 1 };
    },
    recover: () => ({ recovered: true }),
    loadStore: () => ({
      config: { reconciliation: { enabled: true } },
      managedPullRequests: [],
    }),
    reconciliationDelayForStore: () => 45_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });

  pool.tick('repo-a');
  pool.tick('repo-b');
  pool.reconcileTick('repo-a');
  pool.reconcileTick('repo-b');
  assert.deepEqual(reviewRoots, ['/repo-a', '/repo-b']);
  assert.deepEqual(reconcileRoots, ['/repo-a', '/repo-b']);
  assert.equal(pool.status('repo-a').lastReviewError, null);
  assert.equal(pool.status('repo-b').lastReviewError, 'review failed');
  assert.equal(pool.status('repo-a').lastReconciliationError, null);
  assert.equal(pool.status('repo-b').lastReconciliationError, 'reconcile failed');
  assert.equal(pool.status('repo-a').running, true);
  assert.equal(pool.status('repo-b').running, true);
});

test('reconciliation uses repository-specific dynamic delays and reschedules', () => {
  const timers = fakeTimers();
  let active = false;
  const pool = createManagerReviewWorkerPool({
    recover: () => ({}),
    reconcile: () => ({ changed: 0 }),
    loadStore: () => ({
      config: { reconciliation: { enabled: true } },
      managedPullRequests: active ? [{ reviewState: 'queued' }] : [],
    }),
    reconciliationDelayForStore: (store) => store.managedPullRequests.length ? 45_000 : 300_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  assert.equal(pool.status('repo-a').nextReconciliationDelayMs, 300_000);
  active = true;
  pool.reconcileTick('repo-a');
  assert.equal(pool.status('repo-a').nextReconciliationDelayMs, 45_000);
  assert.equal(timers.timeouts[0].cleared, true);
});

test('stopping and closing PR review workers clears both timer types', () => {
  const timers = fakeTimers();
  const pool = createManagerReviewWorkerPool({
    recover: () => ({}),
    loadStore: () => ({ config: { reconciliation: { enabled: false } }, managedPullRequests: [] }),
    reconciliationDelayForStore: () => 300_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.start({ id: 'repo-b', name: 'B', path: '/repo-b' });
  const firstInterval = timers.intervals[0];
  const firstTimeout = timers.timeouts[0];
  const stopped = pool.stop('repo-a');
  assert.equal(stopped.changed, true);
  assert.equal(firstInterval.cleared, true);
  assert.equal(firstTimeout.cleared, true);
  assert.equal(pool.status('repo-b').running, true);
  pool.close();
  assert.equal(pool.list().length, 0);
  assert.equal(timers.intervals[1].cleared, true);
  assert.equal(timers.timeouts[1].cleared, true);
});
