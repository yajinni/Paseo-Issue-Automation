import path from 'node:path';
import { updateManagedDispatch } from './attempts.mjs';
import { dispatchAvailableIssues } from './dispatch-batch.mjs';
import { activeCodingCount } from './fix-jobs.mjs';
import { DEFAULT_MANAGER_CONFIG, loadManagerConfig } from './manager-config.mjs';
import { loadConfig } from './state.mjs';

function snapshot(worker) {
  if (!worker) return { running: false, state: 'stopped' };
  return {
    repositoryId: worker.repositoryId,
    repositoryName: worker.repositoryName,
    root: worker.root,
    running: worker.running === true,
    state: worker.running ? 'running' : 'stopped',
    intervalSeconds: worker.intervalSeconds,
    startedAt: worker.startedAt,
    lastTickAt: worker.lastTickAt,
    lastResult: worker.lastResult,
    lastError: worker.lastError,
    lastScheduleReason: worker.lastScheduleReason,
    activeCount: worker.activeCount,
    capacityError: worker.capacityError,
    pending: worker.pending === true,
    ticking: worker.ticking === true,
  };
}

function rotated(values, afterId) {
  if (!values.length || !afterId) return values;
  const index = values.findIndex((item) => item.repositoryId === afterId);
  if (index < 0) return values;
  return [...values.slice(index + 1), ...values.slice(0, index + 1)];
}

export function createManagerWorkerPool({
  dispatch = dispatchAvailableIssues,
  updateDispatch = updateManagedDispatch,
  countActive = activeCodingCount,
  readConfig = loadConfig,
  readManagerConfig = loadManagerConfig,
  managerConfigOptions = {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date(),
} = {}) {
  const workers = new Map();
  const pending = new Set();
  let draining = false;
  let lastServedId = null;
  let lastCapacity = {
    globalMaxActive: DEFAULT_MANAGER_CONFIG.globalMaxActive,
    active: 0,
    available: DEFAULT_MANAGER_CONFIG.globalMaxActive,
    checkedAt: null,
    errors: [],
  };

  function runningWorkers() {
    return [...workers.values()]
      .filter((worker) => worker.running)
      .sort((left, right) =>
        String(left.repositoryName).localeCompare(String(right.repositoryName))
        || left.repositoryId.localeCompare(right.repositoryId));
  }

  function capacity() {
    const managerConfig = readManagerConfig(managerConfigOptions);
    const errors = [];
    let active = 0;
    for (const worker of runningWorkers()) {
      try {
        worker.activeCount = Math.max(0, Number(countActive(worker.root)) || 0);
        worker.capacityError = null;
      } catch (error) {
        worker.capacityError = error instanceof Error ? error.message : String(error);
        errors.push({ repositoryId: worker.repositoryId, error: worker.capacityError });
        const repositoryMaximum = Math.max(1, Number(readConfig(worker.root).maxActive) || 1);
        worker.activeCount = repositoryMaximum;
      }
      active += worker.activeCount;
    }
    lastCapacity = {
      globalMaxActive: managerConfig.globalMaxActive,
      active,
      available: Math.max(0, managerConfig.globalMaxActive - active),
      checkedAt: now().toISOString(),
      errors,
    };
    return lastCapacity;
  }

  function nextPendingWorker() {
    const candidates = rotated(runningWorkers(), lastServedId)
      .filter((worker) => pending.has(worker.repositoryId));
    return candidates[0] || null;
  }

  function markCapacityWait(current) {
    const reason = current.errors.length
      ? `Global coding capacity cannot be confirmed safely: ${current.errors.map((item) => `${item.repositoryId}: ${item.error}`).join('; ')}`
      : `Global coding capacity reached (${current.active}/${current.globalMaxActive}).`;
    for (const repositoryId of pending) {
      const worker = workers.get(repositoryId);
      if (worker) worker.lastScheduleReason = reason;
    }
  }

  function drain() {
    if (draining) return managerStatus({ refreshCapacity: false });
    draining = true;
    try {
      while (pending.size) {
        const current = capacity();
        if (current.available < 1) {
          markCapacityWait(current);
          break;
        }
        const worker = nextPendingWorker();
        if (!worker) break;
        pending.delete(worker.repositoryId);
        worker.pending = false;
        worker.ticking = true;
        worker.lastScheduleReason = null;
        try {
          const result = dispatch(worker.root, { maxClaims: 1 });
          updateDispatch(worker.root, result);
          worker.lastResult = result;
          worker.lastError = null;
          lastServedId = worker.repositoryId;
        } catch (error) {
          worker.lastError = error instanceof Error ? error.message : String(error);
          worker.lastResult = null;
          lastServedId = worker.repositoryId;
        } finally {
          worker.ticking = false;
        }
      }
    } finally {
      draining = false;
    }
    return managerStatus({ refreshCapacity: false });
  }

  function tick(repositoryId) {
    const worker = workers.get(String(repositoryId));
    if (!worker?.running) return snapshot(worker);
    worker.lastTickAt = now().toISOString();
    pending.add(worker.repositoryId);
    worker.pending = true;
    drain();
    return snapshot(worker);
  }

  function start(repository) {
    if (!repository?.id || !repository?.path) throw new Error('A registered repository is required to start a worker.');
    const repositoryId = String(repository.id);
    const root = path.resolve(repository.path);
    const existing = workers.get(repositoryId);
    if (existing?.running) {
      if (path.resolve(existing.root) !== root) {
        throw new Error(`Worker ${repositoryId} is already running for a different repository path.`);
      }
      return snapshot(existing);
    }
    const config = readConfig(root);
    const intervalSeconds = Number(config.pollIntervalSeconds);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
      throw new Error('Repository pollIntervalSeconds must be an integer of at least 60.');
    }
    const worker = {
      repositoryId,
      repositoryName: repository.repository || repository.name || repositoryId,
      root,
      running: true,
      intervalSeconds,
      startedAt: now().toISOString(),
      lastTickAt: null,
      lastResult: null,
      lastError: null,
      lastScheduleReason: null,
      activeCount: 0,
      capacityError: null,
      pending: false,
      ticking: false,
      timer: null,
    };
    worker.timer = setIntervalFn(() => tick(repositoryId), intervalSeconds * 1000);
    worker.timer?.unref?.();
    workers.set(repositoryId, worker);
    return snapshot(worker);
  }

  function stop(repositoryId) {
    const id = String(repositoryId || '');
    const worker = workers.get(id);
    if (!worker) return { repositoryId: id || null, running: false, state: 'stopped', changed: false };
    if (worker.timer) clearIntervalFn(worker.timer);
    pending.delete(id);
    worker.pending = false;
    worker.running = false;
    worker.timer = null;
    workers.delete(id);
    if (lastServedId === id) lastServedId = null;
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
    return runningWorkers().map(snapshot);
  }

  function managerStatus({ refreshCapacity = true } = {}) {
    const current = refreshCapacity ? capacity() : lastCapacity;
    return {
      ...current,
      runningWorkerCount: runningWorkers().length,
      pendingRepositoryIds: [...pending],
      lastServedRepositoryId: lastServedId,
      draining,
    };
  }

  function close() {
    for (const id of [...workers.keys()]) stop(id);
  }

  return { start, stop, restart, refresh, tick, drain, status, list, managerStatus, close };
}
