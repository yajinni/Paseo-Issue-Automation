import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { sanitizeDurableText } from './persistent-text-safety.mjs';
import { statePaths } from './state.mjs';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
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

function archiveFiles(root) {
  const directory = logDirectory(root);
  return readdirSync(directory)
    .map((name) => {
      const match = /^events\.(\d+)\.jsonl$/.exec(name);
      return match ? { index: Number(match[1]), file: path.join(directory, name) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
}

function truncateString(value) {
  const text = sanitizeDurableText(String(value ?? ''));
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

function sanitizeStoredEvent(event) {
  if (!event || typeof event !== 'object') return event;
  return {
    ...event,
    message: typeof event.message === 'string' ? truncateString(event.message) : event.message,
    details: event.details && typeof event.details === 'object'
      ? sanitizeLogDetails(event.details)
      : event.details,
  };
}

function parseLogFile(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return sanitizeStoredEvent(JSON.parse(line)); } catch { return null; }
    })
    .filter(Boolean)
    .reverse();
}

function newestEventTimestamp(file) {
  for (const event of parseLogFile(file)) {
    const parsed = Date.parse(event?.timestamp || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pruneExpiredArchives(root, now = Date.now()) {
  const cutoff = Number(now) - RETENTION_MS;
  for (const archive of archiveFiles(root)) {
    const newest = newestEventTimestamp(archive.file);
    if (newest !== null && newest < cutoff) rmSync(archive.file, { force: true });
  }
}

function rotateLogs(root, now = Date.now()) {
  pruneExpiredArchives(root, now);
  const file = currentLogFile(root);
  if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return;
  const archives = archiveFiles(root).sort((left, right) => right.index - left.index);
  for (const archive of archives) {
    const destination = archiveLogFile(root, archive.index + 1);
    rmSync(destination, { force: true });
    renameSync(archive.file, destination);
  }
  renameSync(file, archiveLogFile(root, 1));
}

function normalizeLevel(value) {
  const level = String(value || 'info').toLowerCase();
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function normalizeStatus(value, level) {
  const status = String(value || '').toLowerCase();
  if (['started', 'success', 'failed', 'skipped', 'waiting', 'cancelled', 'paused'].includes(status)) return status;
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
  rotateLogs(root, Date.now());
  appendFileSync(currentLogFile(root), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

function logFilesNewestFirst(root, now = Date.now()) {
  pruneExpiredArchives(root, now);
  const files = [currentLogFile(root), ...archiveFiles(root).map((archive) => archive.file)];
  return files.filter(existsSync);
}

function matchesFilters(event, options) {
  if (options.since && String(event.timestamp) < String(options.since)) return false;
  if (options.level && event.level !== options.level) return false;
  if (options.category && event.category !== options.category) return false;
  if (options.before && String(event.timestamp) >= String(options.before)) return false;
  if (options.query) {
    const haystack = `${event.category} ${event.action} ${event.message} ${JSON.stringify(event.details || {})}`.toLowerCase();
    if (!haystack.includes(options.query.toLowerCase())) return false;
  }
  return true;
}

function lifecycleLevel(status) {
  const value = String(status || '').toLowerCase();
  if (['error', 'failed', 'failure'].includes(value)) return 'error';
  if (['warning', 'warn', 'attention', 'stale'].includes(value)) return 'warn';
  if (value === 'debug') return 'debug';
  return 'info';
}

function lifecycleStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['error', 'failed', 'failure'].includes(value)) return 'failed';
  if (['cancelled', 'canceled'].includes(value)) return 'cancelled';
  if (['waiting', 'queued', 'pending'].includes(value)) return 'waiting';
  if (value === 'paused') return 'paused';
  return 'success';
}

function lifecycleLogEvents(root, since) {
  if (!since) return [];
  const directory = statePaths(root).lifecycle;
  if (!existsSync(directory)) return [];
  const events = [];
  for (const name of readdirSync(directory)) {
    if (!/^issue-\d+\.jsonl$/.test(name)) continue;
    const file = path.join(directory, name);
    for (const lifecycle of parseLogFile(file)) {
      const timestamp = lifecycle.at || lifecycle.timestamp || null;
      if (!timestamp || timestamp < since) continue;
      const issueNumber = Number(lifecycle.issueNumber) || null;
      const level = lifecycleLevel(lifecycle.status);
      events.push({
        id: `issue-lifecycle:${lifecycle.id || `${issueNumber}:${timestamp}:${lifecycle.type || 'event'}`}`,
        timestamp,
        level,
        category: 'issues',
        action: truncateString(lifecycle.type || 'lifecycle-event'),
        status: lifecycleStatus(lifecycle.status),
        source: truncateString(lifecycle.source || 'controller'),
        message: truncateString(`${issueNumber ? `Issue #${issueNumber}: ` : ''}${lifecycle.message || lifecycle.type || 'Issue lifecycle event'}`),
        details: sanitizeLogDetails({
          issueNumber,
          attempt: lifecycle.attempt ?? null,
          lifecycleStatus: lifecycle.status || null,
          evidence: lifecycle.evidence || {},
        }),
      });
    }
  }
  return events;
}

export function listControllerLogs(root, options = {}) {
  const limit = Math.max(1, Math.min(10_000, Number(options.limit) || 250));
  const normalized = {
    level: options.level ? normalizeLevel(options.level) : null,
    category: options.category ? String(options.category) : null,
    query: options.query ? String(options.query).trim() : '',
    before: options.before ? String(options.before) : null,
    since: options.since ? String(options.since) : null,
  };
  const allEvents = [];
  const categories = new Set();
  for (const file of logFilesNewestFirst(root)) {
    for (const event of parseLogFile(file)) {
      if (normalized.since && String(event.timestamp) < normalized.since) continue;
      if (event.category) categories.add(event.category);
      if (matchesFilters(event, normalized)) allEvents.push(event);
    }
  }
  for (const event of lifecycleLogEvents(root, normalized.since)) {
    if (event.category) categories.add(event.category);
    if (matchesFilters(event, normalized)) allEvents.push(event);
  }
  allEvents.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
  const events = allEvents.slice(0, limit);
  return {
    events,
    categories: [...categories].sort(),
    hasMore: allEvents.length > limit,
    nextBefore: events.at(-1)?.timestamp || null,
    retention: {
      days: RETENTION_DAYS,
      maxFileBytes: MAX_LOG_BYTES,
      archivePolicy: 'Keep rotated archives while they contain events from the rolling retention window.',
    },
  };
}

export function controllerLogStatus(root) {
  const files = logFilesNewestFirst(root);
  return {
    available: true,
    directory: logDirectory(root),
    files: files.map((file) => ({ name: path.basename(file), bytes: statSync(file).size })),
    retentionDays: RETENTION_DAYS,
  };
}
