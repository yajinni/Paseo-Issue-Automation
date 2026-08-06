import path from 'node:path';
import {
  addRepository,
  findRepository,
  inspectRepository,
  listRepositories,
  removeRepository,
} from './repository-registry.mjs';

function normalizedPath(value, platform = process.platform) {
  const resolved = path.resolve(String(value || '').trim());
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function decoded(value) {
  try { return decodeURIComponent(value); }
  catch { throw new Error(`Invalid encoded repository selector: ${value}`); }
}

export function parseRepositoryApiPath(pathname) {
  const value = String(pathname || '');
  if (value === '/api/repositories') {
    return { matched: true, selector: null, repositoryPath: null };
  }
  const match = value.match(/^\/api\/repositories\/([^/]+)(\/.*)?$/);
  if (!match) return { matched: false, selector: null, repositoryPath: null };
  return {
    matched: true,
    selector: decoded(match[1]),
    repositoryPath: match[2] || '',
  };
}

export function repositoryRegistryRequest({ method, pathname, body = {} }, options = {}) {
  const route = parseRepositoryApiPath(pathname);
  if (!route.matched || route.repositoryPath) return { handled: false };
  if (!route.selector && method === 'GET') {
    return { handled: true, status: 200, body: { repositories: listRepositories(options) } };
  }
  if (!route.selector && method === 'POST') {
    const repositoryPath = String(body.path || '').trim();
    if (!repositoryPath) throw new Error('Repository path is required.');
    return { handled: true, status: 201, body: { repository: addRepository(repositoryPath, options) } };
  }
  if (route.selector && method === 'GET') {
    const repository = findRepository(route.selector, options);
    if (!repository) throw new Error(`Repository ${route.selector} is not registered.`);
    return { handled: true, status: 200, body: { repository } };
  }
  if (route.selector && method === 'DELETE') {
    const result = removeRepository(route.selector, options);
    if (!result.removed) throw new Error(`Repository ${route.selector} is not registered.`);
    return { handled: true, status: 200, body: { repository: result.repository } };
  }
  return { handled: true, status: 405, body: { error: 'Method not allowed' } };
}

export function resolveRepositoryApiContext(pathname, {
  rootDir,
  runner,
  platform = process.platform,
} = {}) {
  const route = parseRepositoryApiPath(pathname);
  if (!route.matched || !route.selector || !route.repositoryPath) return null;
  const repository = findRepository(route.selector, { rootDir, platform });
  if (!repository) throw new Error(`Repository ${route.selector} is not registered.`);
  const inspected = inspectRepository(repository.path, { runner, platform });
  if (normalizedPath(inspected.path, platform) !== normalizedPath(repository.path, platform)) {
    throw new Error(
      `Registered path ${repository.path} now resolves to a different Git repository root: ${inspected.path}.`,
    );
  }
  const legacyPathname = route.repositoryPath.startsWith('/api/')
    ? route.repositoryPath
    : `/api${route.repositoryPath}`;
  return {
    repository: {
      ...repository,
      path: inspected.path,
      remote: inspected.remote,
      repository: inspected.repository || repository.repository,
    },
    root: inspected.path,
    pathname: legacyPathname,
  };
}
