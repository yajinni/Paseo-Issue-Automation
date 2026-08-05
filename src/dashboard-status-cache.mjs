import { Worker } from 'node:worker_threads';

const ACTIVE_REFRESH_MS = 45_000;
const IDLE_REFRESH_MS = 300_000;
const coordinators = new Map();

function coordinator(root) {
  let current = coordinators.get(root);
  if (!current) {
    current = {
      lastGood: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      refreshing: false,
      refreshPromise: null,
    };
    coordinators.set(root, current);
  }
  return current;
}

function workerRefresh(input, { workerFactory } = {}) {
  const create = workerFactory || ((url) => new Worker(url));
  return new Promise((resolve, reject) => {
    const worker = create(new URL('./dashboard-status-worker.mjs', import.meta.url));
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      const termination = worker.terminate?.();
      termination?.catch?.(() => {});
      callback(value);
    };
    worker.once('message', (message) => {
      if (message?.ok) finish(resolve, message.result);
      else finish(reject, new Error(message?.error || 'Dashboard status worker failed.'));
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(reject, new Error(`Dashboard status worker exited with code ${code}.`));
    });
    worker.postMessage(input);
  });
}

export function dashboardRefreshInterval(input = {}) {
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];
  const active = attempts.some((attempt) => ['agent-running', 'human-review'].includes(attempt?.status));
  return active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

export function requestDashboardStatusRefresh(root, input, options = {}) {
  const current = coordinator(root);
  if (current.refreshPromise) return current.refreshPromise;
  current.refreshing = true;
  current.lastAttemptAt = new Date().toISOString();
  current.refreshPromise = workerRefresh({ root, ...input }, options)
    .then((result) => {
      current.lastGood = result;
      current.lastSuccessAt = new Date().toISOString();
      current.lastError = null;
      return result;
    })
    .catch((error) => {
      current.lastError = String(error?.message || error);
      return null;
    })
    .finally(() => {
      current.refreshing = false;
      current.refreshPromise = null;
    });
  return current.refreshPromise;
}

export function cachedDashboardRemoteState(root, input, options = {}) {
  const current = coordinator(root);
  const lastAttempt = current.lastAttemptAt ? Date.parse(current.lastAttemptAt) : 0;
  const stale = !lastAttempt || Date.now() - lastAttempt >= dashboardRefreshInterval(input);
  if (options.force === true || stale) {
    requestDashboardStatusRefresh(root, input, options).catch(() => {});
  }
  const updatedAt = current.lastSuccessAt;
  const remoteAgeMs = updatedAt ? Math.max(0, Date.now() - Date.parse(updatedAt)) : null;
  return {
    remote: current.lastGood,
    statusMeta: {
      state: current.lastGood
        ? current.lastError ? 'stale' : current.refreshing ? 'refreshing' : 'fresh'
        : current.refreshing ? 'refreshing' : current.lastError ? 'failed' : 'empty',
      refreshing: current.refreshing,
      remoteUpdatedAt: updatedAt,
      remoteAgeMs,
      lastAttemptAt: current.lastAttemptAt,
      lastError: current.lastError,
    },
  };
}

export function clearDashboardStatusCache(root) {
  if (root) coordinators.delete(root);
  else coordinators.clear();
}

export function dashboardStatusCacheSnapshot(root) {
  const current = coordinator(root);
  return {
    lastGood: current.lastGood,
    lastAttemptAt: current.lastAttemptAt,
    lastSuccessAt: current.lastSuccessAt,
    lastError: current.lastError,
    refreshing: current.refreshing,
  };
}
