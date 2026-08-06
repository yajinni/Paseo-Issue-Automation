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
  if (method === 'GET' && context.pathname === '/api/status') {
    return {
      handled: true,
      status: 200,
      body: { status: managerRepositoryStatus(context.repository, options) },
    };
  }
  return {
    handled: true,
    status: method === 'GET' ? 404 : 405,
    body: {
      error: method === 'GET'
        ? `Manager route ${context.pathname} is not available.`
        : 'Repository mutations are not enabled in the standalone manager yet.',
      readOnly: true,
    },
  };
}
