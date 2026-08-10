import path from 'node:path';
import { reconcileManualReviews } from './manual-review-reconcile.mjs';
import { tickReviewScheduler } from './pr-review-scheduler.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { reconciliationDelay } from './reconciliation-timing.mjs';
import {
  reconcileManagedPullRequestsWithWebFullReview,
  recoverPrReviewStateWithWebFullReview,
} from './web-chatgpt-full-review-reconcile.mjs';

const REVIEW_TICK_MS = 5_000;
const FALLBACK_RECONCILIATION_DELAY_MS = 300_000;

function snapshot(worker) {
  if (!worker) return { running: false, state: 'stopped' };
  return {
    repositoryId: worker.repositoryId,
    repositoryName: worker.repositoryName,
    root: worker.root,
    running: worker.running === true,
    state: worker.running ? 'running' : 'stopped',
    startedAt: worker.startedAt,
    reviewIntervalMs: REVIEW_TICK_MS,
    lastReviewTickAt: worker.lastReviewTickAt,
    lastReviewResult: worker.lastReviewResult,
    lastReviewError: worker.lastReviewError,
    lastReconciliationAt: worker.lastReconciliationAt,
    lastReconciliationResult: worker.lastReconciliationResult,
    lastReconciliationError: worker.lastReconciliationError,
    nextReconciliationDelayMs: worker.nextReconciliationDelayMs,
    startupRecovery: worker.startupRecovery,
    startupRecoveryPending: worker.startupRecoveryPending === true,
    startupRecovering: worker.startupRecovering === true,
    reviewTicking: worker.reviewTicking === true,
    reconciling: worker.reconciling === true,
  };
}

export function createManagerReviewWorkerPool({
  reviewTick = tickReviewScheduler,
  reconcile = reconcileManagedPullRequestsWithWebFullReview,
  reconcileManual = reconcileManualReviews,
  recover = recoverPrReviewStateWithWebFullReview,
  loadStore = loadPrReviewStore,
  reconciliationDelayForStore = reconciliationDelay,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = () => new Date(),
} = {}) {
  const workers = new Map();

  function tick(repositoryId) {
    const worker = workers.get(String(repositoryId));
    if (!worker?.running || worker.reviewTicking || worker.startupRecoveryPending || worker.startupRecovering) return snapshot(worker);
    worker.reviewTicking = true;
    worker.lastReviewTickAt = now().toISOString();
    try {
      worker.lastReviewResult = reviewTick(worker.root);
      worker.lastReviewError = null;
    } catch (error) {
      worker.lastReviewResult = null;
      worker.lastReviewError = error instanceof Error ? error.message : String(error);
    } finally {
      worker.reviewTicking = false;
    }
    return snapshot(worker);
  }

  function startupRecoveryTick(repositoryId) {
    const worker = workers.get(String(repositoryId));
    if (!worker?.running || worker.startupRecovering) return snapshot(worker);
    worker.startupRecoveryTimer = null;
    worker.startupRecoveryPending = false;
    worker.startupRecovering = true;
    try {
      worker.startupRecovery = {
        ok: true,
        result: {
          managed: recover(worker.root),
          manual: reconcileManual(worker.root),
        },
      };
    } catch (error) {
      worker.startupRecovery = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      worker.startupRecovering = false;
    }
    return snapshot(worker);
  }

  function scheduleStartupRecovery(worker) {
    if (!worker?.running) return;
    if (worker.startupRecoveryTimer) clearTimeoutFn(worker.startupRecoveryTimer);
    worker.startupRecoveryPending = true;
    worker.startupRecoveryTimer = setTimeoutFn(() => startupRecoveryTick(worker.repositoryId), 0);
    worker.startupRecoveryTimer?.unref?.();
  }

  function scheduleReconciliation(worker) {
    if (!worker?.running) return;
    if (worker.reconciliationTimer) clearTimeoutFn(worker.reconciliationTimer);
    let delay = FALLBACK_RECONCILIATION_DELAY_MS;
    try {
      delay = reconciliationDelayForStore(loadStore(worker.root));
    } catch (error) {
      worker.lastReconciliationError = error instanceof Error ? error.message : String(error);
    }
    worker.nextReconciliationDelayMs = delay;
    worker.reconciliationTimer = setTimeoutFn(() => reconcileTick(worker.repositoryId), delay);
    worker.reconciliationTimer?.unref?.();
  }

  function reconcileTick(repositoryId) {
    const worker = workers.get(String(repositoryId));
    if (!worker?.running || worker.reconciling || worker.startupRecoveryPending || worker.startupRecovering) return snapshot(worker);
    worker.reconciling = true;
    worker.lastReconciliationAt = now().toISOString();
    try {
      const store = loadStore(worker.root);
      worker.lastReconciliationResult = store.config.reconciliation.enabled
        ? {
            managed: reconcile(worker.root),
            manual: reconcileManual(worker.root),
          }
        : { skipped: true, reason: 'Repository reconciliation is disabled.' };
      worker.lastReconciliationError = null;
    } catch (error) {
      worker.lastReconciliationResult = null;
      worker.lastReconciliationError = error instanceof Error ? error.message : String(error);
    } finally {
      worker.reconciling = false;
      if (worker.running) scheduleReconciliation(worker);
    }
    return snapshot(worker);
  }

  function start(repository) {
    if (!repository?.id || !repository?.path) throw new Error('A registered repository is required to start a PR-review worker.');
    const repositoryId = String(repository.id);
    const root = path.resolve(repository.path);
    const existing = workers.get(repositoryId);
    if (existing?.running) {
      if (path.resolve(existing.root) !== root) {
        throw new Error(`PR-review worker ${repositoryId} is already running for a different repository path.`);
      }
      return snapshot(existing);
    }
    const worker = {
      repositoryId,
      repositoryName: repository.repository || repository.name || repositoryId,
      root,
      running: true,
      startedAt: now().toISOString(),
      reviewTimer: null,
      reconciliationTimer: null,
      startupRecoveryTimer: null,
      lastReviewTickAt: null,
      lastReviewResult: null,
      lastReviewError: null,
      lastReconciliationAt: null,
      lastReconciliationResult: null,
      lastReconciliationError: null,
      nextReconciliationDelayMs: null,
      startupRecovery: null,
      startupRecoveryPending: false,
      startupRecovering: false,
      reviewTicking: false,
      reconciling: false,
    };
    worker.reviewTimer = setIntervalFn(() => tick(repositoryId), REVIEW_TICK_MS);
    worker.reviewTimer?.unref?.();
    workers.set(repositoryId, worker);
    scheduleStartupRecovery(worker);
    scheduleReconciliation(worker);
    return snapshot(worker);
  }

  function stop(repositoryId) {
    const id = String(repositoryId || '');
    const worker = workers.get(id);
    if (!worker) return { repositoryId: id || null, running: false, state: 'stopped', changed: false };
    if (worker.reviewTimer) clearIntervalFn(worker.reviewTimer);
    if (worker.reconciliationTimer) clearTimeoutFn(worker.reconciliationTimer);
    if (worker.startupRecoveryTimer) clearTimeoutFn(worker.startupRecoveryTimer);
    worker.running = false;
    worker.reviewTimer = null;
    worker.reconciliationTimer = null;
    worker.startupRecoveryTimer = null;
    worker.startupRecoveryPending = false;
    workers.delete(id);
    return { ...snapshot(worker), changed: true };
  }

  function restart(repository) {
    stop(repository?.id);
    return start(repository);
  }

  function refresh(repository) {
    if (!repository?.id || !workers.has(String(repository.id))) return status(repository?.id);
    return restart(repository);
  }

  function status(repositoryId) {
    return snapshot(workers.get(String(repositoryId || '')));
  }

  function list() {
    return [...workers.values()]
      .map(snapshot)
      .sort((left, right) => String(left.repositoryName).localeCompare(String(right.repositoryName)));
  }

  function close() {
    for (const id of [...workers.keys()]) stop(id);
  }

  return { start, stop, restart, refresh, tick, startupRecoveryTick, reconcileTick, status, list, close };
}
