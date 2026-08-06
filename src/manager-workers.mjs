import path from 'node:path';
import { updateManagedDispatch } from './attempts.mjs';
import { dispatchAvailableIssues } from './dispatch-batch.mjs';
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
    ticking: worker.ticking === true,
  };
}

export function createManagerWorkerPool({
  dispatch = dispatchAvailableIssues,
  updateDispatch = updateManagedDispatch,
  readConfig = loadConfig,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date(),
} = {}) {
  const workers = new Map();

  function tick(repositoryId) {
    const worker = workers.get(String(repositoryId));
    if (!worker?.running || worker.ticking) return snapshot(worker);
    worker.ticking = true;
    worker.lastTickAt = now().toISOString();
    try {
      const result = dispatch(worker.root);
      updateDispatch(worker.root, result);
      worker.lastResult = result;
      worker.lastError = null;
    } catch (error) {
      worker.lastError = error instanceof Error ? error.message : String(error);
      worker.lastResult = null;
    } finally {
      worker.ticking = false;
    }
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
    worker.running = false;
    worker.timer = null;
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

  return { start, stop, restart, refresh, tick, status, list, close };
}
