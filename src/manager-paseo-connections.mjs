import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { managerHome } from './repository-registry.mjs';

const VERSION = 1;

function filePath(options = {}) {
  return path.join(options.rootDir || managerHome(options), 'paseo-connections.json');
}

function normalizeHost(value) {
  const host = String(value || '').trim();
  if (!host) return null;
  if (/\s|[?&]password=/i.test(host)) throw new Error('Paseo host is invalid.');
  return host;
}

function loadStore(options = {}) {
  const file = filePath(options);
  if (!existsSync(file)) return { version: VERSION, repositories: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const repositories = parsed?.repositories && typeof parsed.repositories === 'object'
    ? parsed.repositories
    : {};
  return { version: VERSION, repositories };
}

function saveStore(store, options = {}) {
  const file = filePath(options);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: VERSION, repositories: store.repositories || {} }, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

function key(repository) {
  const value = String(repository?.id || repository?.repository || '').trim();
  if (!value) throw new Error('Repository identity is required for the Paseo connection.');
  return value;
}

export function loadManagerPaseoConnection(repository, options = {}) {
  const entry = loadStore(options).repositories[key(repository)] || null;
  if (!entry) return null;
  const host = normalizeHost(entry.host);
  return host ? { host, updatedAt: entry.updatedAt || null } : null;
}

export function saveManagerPaseoConnection(repository, host, options = {}) {
  const normalized = normalizeHost(host);
  if (!normalized) throw new Error('A Paseo host is required.');
  const store = loadStore(options);
  const entry = { host: normalized, updatedAt: new Date().toISOString() };
  store.repositories[key(repository)] = entry;
  saveStore(store, options);
  return entry;
}
