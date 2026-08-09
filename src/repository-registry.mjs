import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { run } from './process.mjs';

export const REPOSITORY_REGISTRY_VERSION = 1;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizedPath(value, platform = process.platform) {
  const resolved = path.resolve(String(value || '').trim());
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizedRemote(value) {
  const remote = String(value || '').trim();
  return remote || null;
}

function repositoryNameFromRemote(remote) {
  const value = normalizedRemote(remote);
  if (!value) return null;
  const match = value.match(/(?:github\.com[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function slug(value) {
  const normalized = String(value || 'repository')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'repository';
}

function repositoryId(root, name, platform = process.platform) {
  const identity = normalizedPath(root, platform).replaceAll('\\', '/');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `${slug(name)}-${digest}`;
}

export function managerHome({
  env = process.env,
  platform = process.platform,
  home = homedir(),
} = {}) {
  if (env.PASEO_ISSUE_AUTOMATION_HOME) return path.resolve(env.PASEO_ISSUE_AUTOMATION_HOME);
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'Paseo Issue Automation');
  }
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'paseo-issue-automation');
  return path.join(home, '.config', 'paseo-issue-automation');
}

export function repositoryRegistryFile(options = {}) {
  return path.join(options.rootDir || managerHome(options), 'repositories.json');
}

function defaultRegistry() {
  return { version: REPOSITORY_REGISTRY_VERSION, repositories: [] };
}

function normalizedRepository(entry, platform = process.platform) {
  if (!entry || typeof entry !== 'object') return null;
  const root = String(entry.path || '').trim();
  if (!root) return null;
  const name = String(entry.name || path.basename(root) || 'Repository').trim();
  return {
    id: String(entry.id || repositoryId(root, entry.repository || name, platform)),
    name,
    path: path.resolve(root),
    remote: normalizedRemote(entry.remote),
    repository: entry.repository ? String(entry.repository) : repositoryNameFromRemote(entry.remote),
    addedAt: entry.addedAt || null,
    updatedAt: entry.updatedAt || entry.addedAt || null,
  };
}

export function loadRepositoryRegistry(options = {}) {
  const file = repositoryRegistryFile(options);
  if (!existsSync(file)) return defaultRegistry();
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  const repositories = Array.isArray(stored?.repositories)
    ? stored.repositories.map((entry) => normalizedRepository(entry, options.platform)).filter(Boolean)
    : [];
  const deduplicated = new Map();
  for (const repository of repositories) {
    deduplicated.set(normalizedPath(repository.path, options.platform), repository);
  }
  return {
    version: REPOSITORY_REGISTRY_VERSION,
    repositories: [...deduplicated.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.path.localeCompare(right.path)),
  };
}

export function saveRepositoryRegistry(registry, options = {}) {
  const file = repositoryRegistryFile(options);
  const normalized = {
    version: REPOSITORY_REGISTRY_VERSION,
    repositories: (registry?.repositories || [])
      .map((entry) => normalizedRepository(entry, options.platform))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path)),
  };
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return clone(normalized);
}

export function inspectRepository(repositoryPath, {
  runner = run,
  platform = process.platform,
} = {}) {
  const requestedPath = path.resolve(String(repositoryPath || '').trim());
  const topLevel = runner('git', ['rev-parse', '--show-toplevel'], {
    cwd: requestedPath,
    allowFailure: true,
  });
  if (!topLevel.ok || !topLevel.stdout) {
    throw new Error(`${requestedPath} is not inside an accessible Git repository.`);
  }
  const root = path.resolve(topLevel.stdout);
  const remoteResult = runner('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    allowFailure: true,
  });
  const remote = remoteResult.ok ? normalizedRemote(remoteResult.stdout) : null;
  const repository = repositoryNameFromRemote(remote);
  const name = repository?.split('/').at(-1) || path.basename(root);
  return {
    id: repositoryId(root, repository || name, platform),
    name,
    path: root,
    remote,
    repository,
  };
}

export function addRepository(repositoryPath, {
  rootDir,
  runner = run,
  now = () => new Date(),
  platform = process.platform,
} = {}) {
  const inspected = inspectRepository(repositoryPath, { runner, platform });
  const registry = loadRepositoryRegistry({ rootDir, platform });
  const key = normalizedPath(inspected.path, platform);
  const existing = registry.repositories.find((entry) => normalizedPath(entry.path, platform) === key);
  const timestamp = now().toISOString();
  const repository = {
    ...existing,
    ...inspected,
    addedAt: existing?.addedAt || timestamp,
    updatedAt: timestamp,
  };
  registry.repositories = [
    ...registry.repositories.filter((entry) => normalizedPath(entry.path, platform) !== key),
    repository,
  ];
  saveRepositoryRegistry(registry, { rootDir, platform });
  return clone(repository);
}

export function listRepositories(options = {}) {
  return clone(loadRepositoryRegistry(options).repositories);
}

export function findRepository(selector, options = {}) {
  const value = String(selector || '').trim();
  if (!value) return null;
  const registry = loadRepositoryRegistry(options);
  const pathKey = normalizedPath(value, options.platform);
  return clone(registry.repositories.find((entry) =>
    entry.id === value
    || entry.repository === value
    || normalizedPath(entry.path, options.platform) === pathKey) || null);
}

export function removeRepository(selector, options = {}) {
  const existing = findRepository(selector, options);
  if (!existing) return { removed: false, repository: null };
  const registry = loadRepositoryRegistry(options);
  registry.repositories = registry.repositories.filter((entry) => entry.id !== existing.id);
  saveRepositoryRegistry(registry, options);
  return { removed: true, repository: existing };
}
