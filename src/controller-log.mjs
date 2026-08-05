import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { statePaths } from './state.mjs';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVES = 5;
const MAX_DETAIL_DEPTH = 5;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 100;
const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|api[-_]?key|session|prompt|messagebody|rawbody)/i;

function logDirectory(root) {
  const stateRoot = statePaths(root).root;
  const directory = path.join(path.dirname(stateRoot), 'paseo-issue-automation-logs');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function currentLogFile(root) {
  return path.join(logDirectory(root), 'events.jsonl');
}

function archiveLogFile(root, index) {
  return path.join(logDirectory(root), `events.${index}.jsonl`);
}

function truncateString(value) {
  const text = String(value ?? '');
  return text.length <= MAX_STRING_LENGTH ? text : `${text.slice(0, MAX_STRING_LENGTH)}…`;
}

export function sanitizeLogDetails(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: truncateString(value.name || 'Error'),
      message: truncateString(value.message || String(value)),
      code: value.code ? truncateString(value.code) : null,
    };
  }
  if (typeof value !== 'object') return truncateString(value);
  if (depth >= MAX_DETAIL_DEPTH) return '[Maximum depth reached]';
  if (seen.has(value)) return '[Circular reference]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeLogDetails(item, depth + 1, seen));
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : sanitizeLogDetails(item, depth + 1, seen);
  }
  return result;
}

function rotateLogs(root) {
  const file = currentLogFile(root);
  if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return;
  rmSync(archiveLogFile(root, MAX_ARCHIVES), { force: true });
  for (let index = MAX_ARCHIVES - 1; index >= 1; index -= 1) {
    const source = archiveLogFile(root, index);
    if (!existsSync(source)) continue;
    const destination = archiveLogFile(root, index + 1);
    rmSync(destination, { force: true });
    renameSync(source, destination);
  }
  renameSync(file, archiveLogFile(root, 1));
}

function normalizeLevel(value) {
  const level = String(value || 'info').toLowerCase();
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function normalizeStatus(value, level) {
  const status = String(value || '').toLowerCase();
  if (['started', 'success', 'failed', 'skipped', 'waiting', 'cancelled'].includes(status)) return status;
  return level === 'error' ? 'failed' : 'success';
}

export function appendControllerLog(root, input = {}) {
  const level = normalizeLevel(input.level);
  const event = {
    id: input.id || randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    level,
    category: truncateString(input.category || 'controller'),
    action: truncateString(input.action || 'event'),
    status: normalizeStatus(input.status, level),
    source: truncateString(input.source || 'system'),
    message: truncateString(input.message || input.action || 'Controller event'),
    details: sanitizeLogDetails(input.details || {}),
  };
  rotateLogs(root);
  appendFileSync(currentLogFile(root), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

function logFilesNewestFirst(root) {
  const files = [currentLogFile(root)];
  for (let index = 1; index <= MAX_ARCHIVES; index += 1) files.push(archiveLogFile(root, index));
  return files.filter(existsSync);
}

function parseLogFile(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .reverse();
}

function matchesFilters(event, options) {
  if (options.level && event.level !== options.level) return false;
  if (options.category && event.category !== options.category) return false;
  if (options.before && String(event.timestamp) >= String(options.before)) return false;
  if (options.query) {
    const haystack = `${event.category} ${event.action} ${event.message} ${JSON.stringify(event.details || {})}`.toLowerCase();
    if (!haystack.includes(options.query.toLowerCase())) return false;
  }
  return true;
}

export function listControllerLogs(root, options = {}) {
  const limit = Math.max(1, Math.min(1_000, Number(options.limit) || 250));
  const normalized = {
    level: options.level ? normalizeLevel(options.level) : null,
    category: options.category ? String(options.category) : null,
    query: options.query ? String(options.query).trim() : '',
    before: options.before ? String(options.before) : null,
  };
  const events = [];
  const categories = new Set();
  for (const file of logFilesNewestFirst(root)) {
    for (const event of parseLogFile(file)) {
      if (event.category) categories.add(event.category);
      if (!matchesFilters(event, normalized)) continue;
      events.push(event);
      if (events.length >= limit) break;
    }
    if (events.length >= limit) break;
  }
  return {
    events,
    categories: [...categories].sort(),
    hasMore: events.length === limit,
    nextBefore: events.at(-1)?.timestamp || null,
    retention: {
      maxFileBytes: MAX_LOG_BYTES,
      maxArchives: MAX_ARCHIVES,
    },
  };
}

export function controllerLogStatus(root) {
  const files = logFilesNewestFirst(root);
  return {
    available: true,
    directory: logDirectory(root),
    files: files.map((file) => ({ name: path.basename(file), bytes: statSync(file).size })),
  };
}
