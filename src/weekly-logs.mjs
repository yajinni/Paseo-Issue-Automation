import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { listControllerLogs, sanitizeLogDetails } from './controller-log.mjs';
import { statePaths } from './state.mjs';

const DEFAULT_DAYS = 7;
const MAX_WEEKLY_EVENTS = 10_000;

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

function parseJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function lifecycleEvents(root, since) {
  const directory = statePaths(root).lifecycle;
  if (!existsSync(directory)) return [];
  const events = [];
  for (const name of readdirSync(directory)) {
    if (!/^issue-\d+\.jsonl$/.test(name)) continue;
    for (const event of parseJsonLines(path.join(directory, name))) {
      const timestamp = event.at || event.timestamp || null;
      if (!timestamp || timestamp < since) continue;
      const issueNumber = Number(event.issueNumber) || null;
      events.push({
        id: `issue-lifecycle:${event.id || `${issueNumber}:${timestamp}:${event.type || 'event'}`}`,
        timestamp,
        level: lifecycleLevel(event.status),
        category: 'issues',
        action: String(event.type || 'lifecycle-event'),
        status: lifecycleStatus(event.status),
        source: String(event.source || 'controller'),
        message: `${issueNumber ? `Issue #${issueNumber}: ` : ''}${event.message || event.type || 'Issue lifecycle event'}`,
        details: sanitizeLogDetails({
          issueNumber,
          attempt: event.attempt ?? null,
          lifecycleStatus: event.status || null,
          evidence: event.evidence || {},
        }),
      });
    }
  }
  return events;
}

export function listWeeklyLogs(root, { days = DEFAULT_DAYS, limit = MAX_WEEKLY_EVENTS, now = Date.now() } = {}) {
  const normalizedDays = Math.max(1, Math.min(30, Number(days) || DEFAULT_DAYS));
  const normalizedLimit = Math.max(1, Math.min(MAX_WEEKLY_EVENTS, Number(limit) || MAX_WEEKLY_EVENTS));
  const since = new Date(Number(now) - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
  const controller = listControllerLogs(root, { since, limit: normalizedLimit });
  const combined = [...controller.events, ...lifecycleEvents(root, since)]
    .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
  const events = combined.slice(0, normalizedLimit);
  const categories = [...new Set(events.map((event) => event.category).filter(Boolean))].sort();
  return {
    events,
    categories,
    hasMore: combined.length > normalizedLimit || controller.hasMore,
    nextBefore: events.at(-1)?.timestamp || null,
    window: { days: normalizedDays, since },
    retention: controller.retention,
  };
}
