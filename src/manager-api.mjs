import { managerRepositoryAction } from './manager-actions.mjs';
import {
  repositoryRegistryRequest,
  resolveRepositoryApiContext,
} from './repository-api-context.mjs';
import { managerRepositoryStatus } from './manager-status.mjs';

export function managerApiRequest({ method, pathname, body = {} }, options = {}) {
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
    const actionHandler = options.actionHandler || managerRepositoryAction;
    const result = actionHandler(context.root, context.pathname, body, options.actions);
    if (result !== null) {
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
