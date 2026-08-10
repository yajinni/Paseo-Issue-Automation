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

const noManual = () => ({ checked: 0, changed: 0, errors: [] });

test('PR review workers start immediately and defer repository recovery', () => {
  const timers = fakeTimers();
  const recovered = [];
  const manual = [];
  const pool = createManagerReviewWorkerPool({
    recover: (root) => { recovered.push(root); return { recovered: root }; },
    reconcileManual: (root) => { manual.push(root); return { checked: 0 }; },
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
  assert.equal(first.startupRecoveryPending, true);
  assert.equal(duplicate.startedAt, first.startedAt);
  assert.equal(second.running, true);
  assert.deepEqual(recovered, []);
  assert.equal(timers.intervals.length, 2);
  assert.ok(timers.intervals.every((timer) => timer.milliseconds === 5_000));
  assert.equal(timers.timeouts.filter((timer) => timer.milliseconds === 0).length, 2);
  assert.equal(timers.timeouts.filter((timer) => timer.milliseconds === 300_000).length, 2);

  for (const timer of timers.timeouts.filter((entry) => entry.milliseconds === 0)) timer.callback();
  assert.deepEqual(recovered, ['/repo-a', '/repo-b']);
  assert.deepEqual(manual, ['/repo-a', '/repo-b']);
  assert.equal(pool.status('repo-a').startupRecoveryPending, false);
  assert.equal(pool.status('repo-a').startupRecovery.ok, true);
});

test('review ticks wait until deferred startup recovery has completed', () => {
  const timers = fakeTimers();
  const reviewRoots = [];
  const pool = createManagerReviewWorkerPool({
    recover: () => ({ recovered: true }),
    reconcileManual: noManual,
    reviewTick: (root) => { reviewRoots.push(root); return { started: false }; },
    loadStore: () => ({ config: { reconciliation: { enabled: false } }, managedPullRequests: [] }),
    reconciliationDelayForStore: () => 300_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  pool.tick('repo-a');
  assert.deepEqual(reviewRoots, []);
  timers.timeouts.find((timer) => timer.milliseconds === 0).callback();
  pool.tick('repo-a');
  assert.deepEqual(reviewRoots, ['/repo-a']);
});

test('review scheduler and reconciliation failures remain repository isolated', () => {
  const timers = fakeTimers();
  const reviewRoots = [];
  const reconcileRoots = [];
  const manualRoots = [];
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
    reconcileManual: (root) => {
      manualRoots.push(root);
      return { checked: 0 };
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
  for (const timer of timers.timeouts.filter((entry) => entry.milliseconds === 0)) timer.callback();

  pool.tick('repo-a');
  pool.tick('repo-b');
  pool.reconcileTick('repo-a');
  pool.reconcileTick('repo-b');
  assert.deepEqual(reviewRoots, ['/repo-a', '/repo-b']);
  assert.deepEqual(reconcileRoots, ['/repo-a', '/repo-b']);
  assert.deepEqual(manualRoots, ['/repo-a']);
  assert.equal(pool.status('repo-a').lastReviewError, null);
  assert.equal(pool.status('repo-b').lastReviewError, 'review failed');
  assert.equal(pool.status('repo-a').lastReconciliationError, null);
  assert.equal(pool.status('repo-b').lastReconciliationError, 'reconcile failed');
  assert.equal(pool.status('repo-a').running, true);
  assert.equal(pool.status('repo-b').running, true);
});

test('reconciliation includes manual review maintenance alongside managed review maintenance', () => {
  const timers = fakeTimers();
  const calls = [];
  const pool = createManagerReviewWorkerPool({
    recover: () => ({}),
    reconcile: (root) => { calls.push(`managed:${root}`); return { checked: 2 }; },
    reconcileManual: (root) => { calls.push(`manual:${root}`); return { checked: 1, changed: 1 }; },
    loadStore: () => ({
      config: { reconciliation: { enabled: true } },
      managedPullRequests: [{ reviewState: 'paused' }],
    }),
    reconciliationDelayForStore: () => 45_000,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  pool.start({ id: 'repo-a', name: 'A', path: '/repo-a' });
  timers.timeouts.find((timer) => timer.milliseconds === 0).callback();
  pool.reconcileTick('repo-a');
  assert.deepEqual(calls.slice(-2), ['managed:/repo-a', 'manual:/repo-a']);
  assert.deepEqual(pool.status('repo-a').lastReconciliationResult, {
    managed: { checked: 2 },
    manual: { checked: 1, changed: 1 },
  });
});

test('reconciliation uses repository-specific dynamic delays and reschedules', () => {
  const timers = fakeTimers();
  let active = false;
  const pool = createManagerReviewWorkerPool({
    recover: () => ({}),
    reconcile: () => ({ changed: 0 }),
    reconcileManual: noManual,
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
  timers.timeouts.find((timer) => timer.milliseconds === 0).callback();
  const firstReconciliation = timers.timeouts.find((timer) => timer.milliseconds === 300_000);
  active = true;
  pool.reconcileTick('repo-a');
  assert.equal(pool.status('repo-a').nextReconciliationDelayMs, 45_000);
  assert.equal(firstReconciliation.cleared, true);
});

test('stopping and closing PR review workers clears review, recovery, and reconciliation timers', () => {
  const timers = fakeTimers();
  const pool = createManagerReviewWorkerPool({
    recover: () => ({}),
    reconcileManual: noManual,
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
  const firstRecovery = timers.timeouts[0];
  const firstReconciliation = timers.timeouts[1];
  const stopped = pool.stop('repo-a');
  assert.equal(stopped.changed, true);
  assert.equal(firstInterval.cleared, true);
  assert.equal(firstRecovery.cleared, true);
  assert.equal(firstReconciliation.cleared, true);
  assert.equal(pool.status('repo-b').running, true);
  pool.close();
  assert.equal(pool.list().length, 0);
  assert.equal(timers.intervals[1].cleared, true);
  assert.equal(timers.timeouts[2].cleared, true);
  assert.equal(timers.timeouts[3].cleared, true);
});
