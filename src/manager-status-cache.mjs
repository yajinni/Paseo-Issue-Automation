import { Worker } from 'node:worker_threads';

const REFRESH_INTERVAL_MS = 15_000;

function repositoryKey(repository) {
  return String(repository?.id || repository?.path || '').trim();
}

function workerStatus(manager, repositoryId, fallbackState) {
  try {
    return manager?.status?.(repositoryId) || { running: false, state: fallbackState };
  } catch (error) {
    return { running: false, state: fallbackState, lastError: error instanceof Error ? error.message : String(error) };
  }
}

function pendingStatus(repository, refresh) {
  return {
    repository: { ...repository },
    setup: { complete: false, baseBranch: null },
    workQueue: { items: [], counts: {}, total: 0, active: 0, attention: 0 },
    automation: { activeRunCount: 0, runCount: 0, statusCounts: {} },
    prReviews: { available: false, enabled: false, queuePaused: true, waitingReviewCount: 0, activeReviewJobId: null },
    worker: { running: false, state: 'refreshing' },
    reviewWorker: { running: false, state: 'refreshing' },
    capabilities: {},
    statusRefresh: refresh,
  };
}

export function createManagerStatusCache({
  rootDir,
  workerManager,
  reviewWorkerManager,
  workerFactory = (workerData) => new Worker(new URL('./manager-status-worker.mjs', import.meta.url), {
    type: 'module',
    workerData,
  }),
  refreshIntervalMs = REFRESH_INTERVAL_MS,
} = {}) {
  const entries = new Map();
  const workers = new Map();
  let closePromise = null;
  let closing = false;
  const timer = refreshIntervalMs > 0
    ? setInterval(() => {
      for (const entry of entries.values()) refresh(entry.repository);
    }, refreshIntervalMs)
    : null;
  timer?.unref?.();

  function refresh(repository) {
    if (closing) return;
    const key = repositoryKey(repository);
    if (!key) return;
    const previous = entries.get(key) || { repository: { ...repository }, status: null, error: null, loadedAt: null };
    if (workers.has(key)) return;
    const startedAt = new Date().toISOString();
    entries.set(key, { ...previous, repository: { ...repository }, refreshingAt: startedAt });
    let worker;
    try {
      worker = workerFactory({
        repository: { ...repository },
        rootDir,
        workerStatus: workerStatus(workerManager, repository.id, 'stopped'),
        reviewWorkerStatus: workerStatus(reviewWorkerManager, repository.id, 'stopped'),
      });
      workers.set(key, worker);
    } catch (error) {
      entries.set(key, {
        ...previous,
        repository: { ...repository },
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
        refreshingAt: null,
      });
      return;
    }

    let settled = false;
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      workers.delete(key);
      if (closing) return;
      entries.set(key, { ...previous, ...patch, repository: { ...repository }, refreshingAt: null });
    };
    worker.once('message', (message) => {
      if (message?.ok && message.status) {
        finish({ status: message.status, error: null, loadedAt: new Date().toISOString(), failedAt: null });
      } else {
        finish({ error: String(message?.error || 'Repository status refresh failed.'), failedAt: new Date().toISOString() });
      }
    });
    worker.once('error', (error) => finish({ error: error.message, failedAt: new Date().toISOString() }));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish({ error: `Repository status worker exited with code ${code}.`, failedAt: new Date().toISOString() });
    });
  }

  function read(repository) {
    const key = repositoryKey(repository);
    if (!key) return pendingStatus(repository, { state: 'unavailable', error: 'Repository identity is missing.' });
    const entry = entries.get(key);
    if (!entry) {
      refresh(repository);
      return pendingStatus(repository, { state: 'refreshing', startedAt: entries.get(key)?.refreshingAt || null });
    }
    if (!entry.status) {
      return pendingStatus(repository, {
        state: entry.error ? 'unavailable' : 'refreshing',
        error: entry.error,
        startedAt: entry.refreshingAt || null,
        failedAt: entry.failedAt || null,
        lastSuccessfulAt: entry.loadedAt || null,
      });
    }
    return {
      ...entry.status,
      statusRefresh: {
        state: entry.refreshingAt ? 'refreshing' : entry.error ? 'delayed' : 'ready',
        error: entry.error,
        startedAt: entry.refreshingAt || null,
        failedAt: entry.failedAt || null,
        lastSuccessfulAt: entry.loadedAt || null,
      },
    };
  }

  function refreshAll(repositories = []) {
    for (const repository of repositories) refresh(repository);
  }

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    if (timer) clearInterval(timer);
    const terminations = [...workers.values()].map((worker) => {
      try {
        return Promise.resolve(worker.terminate?.());
      } catch {
        return Promise.resolve();
      }
    });
    workers.clear();
    closePromise = Promise.allSettled(terminations).then(() => undefined);
    return closePromise;
  }

  return { read, refresh, refreshAll, close };
}
