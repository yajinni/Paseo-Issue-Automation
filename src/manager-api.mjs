import { managerRepositoryAction } from './manager-actions.mjs';
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
  if (!workerManager) throw new Error('The standalone manager worker pool is unavailable.');
  if (pathname === '/api/worker/start') return workerManager.start(context.repository);
  if (pathname === '/api/worker/stop') return workerManager.stop(context.repository.id);
  return workerManager.restart(context.repository);
}

export function managerApiRequest({ method, pathname, body = {} }, options = {}) {
  if (method === 'GET' && pathname === '/api/workers') {
    return {
      handled: true,
      status: 200,
      body: { workers: options.workerManager?.list?.() || [] },
    };
  }

  const route = parseRepositoryApiPath(pathname);
  if (method === 'DELETE' && route.selector && !route.repositoryPath && options.workerManager) {
    const repository = findRepository(route.selector, options);
    if (repository) options.workerManager.stop(repository.id);
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
    const workerResult = workerAction(options.workerManager, context, context.pathname);
    if (workerResult !== null) {
      return {
        handled: true,
        status: 200,
        body: {
          result: workerResult,
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
