import { managerRepositoryAction } from './manager-actions.mjs';
import { loadManagerConfig, saveManagerConfig } from './manager-config.mjs';
import {
  installExternalRepositoryFromManager,
  migrateEmbeddedRepositoryFromManager,
  reconcileEmbeddedMigrationFromManager,
} from './manager-installation.mjs';
import {
  parseRepositoryApiPath,
  repositoryRegistryRequest,
  resolveRepositoryApiContext,
} from './repository-api-context.mjs';
import { findRepository } from './repository-registry.mjs';
import { managerRepositoryStatus } from './manager-status.mjs';

function workerAction(workerManager, context, pathname) {
  const workerRoute = ['/api/worker/start', '/api/worker/stop', '/api/worker/restart'].includes(pathname);
  if (!workerRoute) return null;
  if (!workerManager) throw new Error('The standalone manager coding-worker pool is unavailable.');
  if (pathname === '/api/worker/start') return workerManager.start(context.repository);
  if (pathname === '/api/worker/stop') return workerManager.stop(context.repository.id);
  return workerManager.restart(context.repository);
}

function reviewWorkerAction(reviewWorkerManager, context, pathname) {
  const workerRoute = [
    '/api/review-worker/start',
    '/api/review-worker/stop',
    '/api/review-worker/restart',
  ].includes(pathname);
  if (!workerRoute) return null;
  if (!reviewWorkerManager) throw new Error('The standalone manager PR-review worker pool is unavailable.');
  if (pathname === '/api/review-worker/start') return reviewWorkerManager.start(context.repository);
  if (pathname === '/api/review-worker/stop') return reviewWorkerManager.stop(context.repository.id);
  return reviewWorkerManager.restart(context.repository);
}

function cachedManagerStatus(workerManager) {
  return workerManager?.managerStatus?.({ refreshCapacity: false }) || null;
}

function managerRequest(method, pathname, body, options) {
  if (pathname === '/api/manager/config' && method === 'GET') {
    return { handled: true, status: 200, body: { config: loadManagerConfig(options) } };
  }
  if (pathname === '/api/manager/config' && method === 'POST') {
    const config = saveManagerConfig(body, options);
    options.workerManager?.drain?.();
    return {
      handled: true,
      status: 200,
      body: { config, manager: cachedManagerStatus(options.workerManager) },
    };
  }
  if (pathname === '/api/manager/status' && method === 'GET') {
    return {
      handled: true,
      status: 200,
      body: {
        config: loadManagerConfig(options),
        manager: cachedManagerStatus(options.workerManager),
        workers: options.workerManager?.list?.() || [],
        reviewWorkers: options.reviewWorkerManager?.list?.() || [],
      },
    };
  }
  return null;
}

function installationResult(context, options, handler, dependencyKey) {
  const result = handler(context.repository, {
    workerManager: options.workerManager,
    reviewWorkerManager: options.reviewWorkerManager,
    [dependencyKey]: options[dependencyKey],
  });
  const statusReader = options.statusReader || managerRepositoryStatus;
  return {
    handled: true,
    status: 200,
    body: {
      result,
      status: statusReader(context.repository, options),
    },
  };
}

export function managerApiRequest({ method, pathname, body = {} }, options = {}) {
  const manager = managerRequest(method, pathname, body, options);
  if (manager) return manager;
  if (method === 'GET' && pathname === '/api/workers') {
    return {
      handled: true,
      status: 200,
      body: {
        workers: options.workerManager?.list?.() || [],
        reviewWorkers: options.reviewWorkerManager?.list?.() || [],
      },
    };
  }

  const route = parseRepositoryApiPath(pathname);
  if (method === 'DELETE' && route.selector && !route.repositoryPath) {
    const repository = findRepository(route.selector, options);
    if (repository) {
      options.workerManager?.stop?.(repository.id);
      options.reviewWorkerManager?.stop?.(repository.id);
    }
  }
  const registry = repositoryRegistryRequest({ method, pathname, body }, options);
  if (registry.handled) return registry;

  const context = resolveRepositoryApiContext(pathname, options);
  if (!context) return { handled: false };
  const statusReader = options.statusReader || managerRepositoryStatus;
  if (method === 'GET' && context.pathname === '/api/status') {
    return {
      handled: true,
      status: 200,
      body: { status: statusReader(context.repository, options) },
    };
  }
  if (method === 'POST') {
    if (context.pathname === '/api/install/external') {
      return installationResult(
        context,
        options,
        options.installHandler || installExternalRepositoryFromManager,
        'installer',
      );
    }
    if (context.pathname === '/api/migrate/external') {
      return installationResult(
        context,
        options,
        options.migrationHandler || migrateEmbeddedRepositoryFromManager,
        'migrator',
      );
    }
    if (context.pathname === '/api/migrate/reconcile') {
      return installationResult(
        context,
        options,
        options.migrationReconcileHandler || reconcileEmbeddedMigrationFromManager,
        'reconciler',
      );
    }

    const codingWorkerResult = workerAction(options.workerManager, context, context.pathname);
    if (codingWorkerResult !== null) {
      return {
        handled: true,
        status: 200,
        body: {
          result: codingWorkerResult,
          status: statusReader(context.repository, options),
        },
      };
    }
    const reviewResult = reviewWorkerAction(options.reviewWorkerManager, context, context.pathname);
    if (reviewResult !== null) {
      return {
        handled: true,
        status: 200,
        body: {
          result: reviewResult,
          status: statusReader(context.repository, options),
        },
      };
    }

    const actionHandler = options.actionHandler || managerRepositoryAction;
    const result = actionHandler(context.root, context.pathname, body, options.actions);
    if (result !== null) {
      if (context.pathname === '/api/config') options.workerManager?.refresh?.(context.repository);
      return {
        handled: true,
        status: 200,
        body: {
          result,
          status: statusReader(context.repository, options),
        },
      };
    }
  }
  return {
    handled: true,
    status: method === 'GET' ? 404 : 405,
    body: {
      error: method === 'GET'
        ? `Manager route ${context.pathname} is not available.`
        : `Manager action ${context.pathname} is not available.`,
    },
  };
}
