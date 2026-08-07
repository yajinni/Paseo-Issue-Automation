import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { managerHome } from '../repository-registry.mjs';

export const SETUP_SESSION_STORE_VERSION = 1;
export const SETUP_PAGE_IDS = Object.freeze([
  'paseo',
  'harness',
  'repository',
  'checkout',
  'workspace',
  'issues',
  'review',
  'readiness',
]);

const SECRET_KEY_PATTERN = /(?:password|passwd|secret|token|cookie|authorization|credential|api[_-]?key)/i;
const COMPLETED_SESSION_LIMIT = 20;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function setupSessionFile(options = {}) {
  return path.join(options.rootDir || managerHome(options), 'setup-wizard.json');
}

function atomicWrite(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

function defaultStore() {
  return {
    version: SETUP_SESSION_STORE_VERSION,
    activeSession: null,
    completedSessions: [],
  };
}

function assertNoSecrets(value, pathParts = []) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Setup session state cannot persist secret field ${nextPath.join('.')}.`);
    }
    if (child && typeof child === 'object') assertNoSecrets(child, nextPath);
  }
}

function normalizeBlocker(blocker) {
  if (!blocker || typeof blocker !== 'object') throw new Error('Setup blockers must be structured objects.');
  const code = String(blocker.code || '').trim();
  const message = String(blocker.message || '').trim();
  if (!code || !/^[a-z0-9][a-z0-9-]*$/.test(code)) throw new Error('Setup blocker code is invalid.');
  if (!message) throw new Error('Setup blocker message is required.');
  return {
    code,
    message,
    recoveryAction: blocker.recoveryAction ? String(blocker.recoveryAction) : null,
    details: blocker.details && typeof blocker.details === 'object' ? clone(blocker.details) : null,
  };
}

function normalizeCheck(check) {
  if (!check) return null;
  const blockers = Array.isArray(check.blockers) ? check.blockers.map(normalizeBlocker) : [];
  return {
    ok: check.ok === true && blockers.length === 0,
    checkedAt: check.checkedAt || new Date().toISOString(),
    summary: check.summary ? String(check.summary) : null,
    blockers,
  };
}

function normalizePage(page = {}) {
  const selections = page.selections && typeof page.selections === 'object' ? clone(page.selections) : {};
  assertNoSecrets(selections);
  const lastCheck = normalizeCheck(page.lastCheck);
  return {
    selections,
    lastCheck,
    completed: page.completed === true && lastCheck?.ok === true,
    updatedAt: page.updatedAt || null,
  };
}

function normalizeRepositoryIdentity(identity) {
  if (!identity) return null;
  if (typeof identity !== 'object') throw new Error('Repository identity must be an object.');
  const owner = String(identity.owner || '').trim();
  const name = String(identity.name || '').trim();
  if (!owner || !name) throw new Error('Repository identity requires owner and name.');
  return {
    owner,
    name,
    id: identity.id == null ? null : String(identity.id),
    url: identity.url ? String(identity.url) : null,
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') throw new Error('Setup session is invalid.');
  assertNoSecrets(session);
  const pages = {};
  for (const pageId of SETUP_PAGE_IDS) pages[pageId] = normalizePage(session.pages?.[pageId]);
  const currentPage = SETUP_PAGE_IDS.includes(session.currentPage) ? session.currentPage : SETUP_PAGE_IDS[0];
  return {
    id: String(session.id || randomUUID()),
    status: ['active', 'cancelled', 'completed'].includes(session.status) ? session.status : 'active',
    currentPage,
    repository: normalizeRepositoryIdentity(session.repository),
    baseBranch: session.baseBranch ? String(session.baseBranch) : null,
    managedCheckout: session.managedCheckout && typeof session.managedCheckout === 'object'
      ? clone(session.managedCheckout)
      : null,
    pages,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    completedAt: session.completedAt || null,
    cancelledAt: session.cancelledAt || null,
  };
}

function normalizeStore(value) {
  if (!value || typeof value !== 'object' || value.version !== SETUP_SESSION_STORE_VERSION) {
    throw new Error('Setup session state is corrupt or uses an unsupported version. Reset setup state to continue.');
  }
  return {
    version: SETUP_SESSION_STORE_VERSION,
    activeSession: value.activeSession ? normalizeSession(value.activeSession) : null,
    completedSessions: Array.isArray(value.completedSessions)
      ? value.completedSessions.map(normalizeSession).slice(-COMPLETED_SESSION_LIMIT)
      : [],
  };
}

export function loadSetupSessionStore(options = {}) {
  const file = setupSessionFile(options);
  if (!existsSync(file)) return defaultStore();
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Setup session state is corrupt. Reset setup state to continue.'); }
  return normalizeStore(parsed);
}

export function saveSetupSessionStore(store, options = {}) {
  const normalized = normalizeStore(store);
  atomicWrite(setupSessionFile(options), normalized);
  return normalized;
}

export function resetSetupSessionStore(options = {}) {
  const store = defaultStore();
  atomicWrite(setupSessionFile(options), store);
  return store;
}

export function startSetupSession(options = {}) {
  const store = loadSetupSessionStore(options);
  const now = new Date().toISOString();
  if (store.activeSession?.status === 'active' && options.restart !== true) return store.activeSession;
  if (store.activeSession) {
    const retained = {
      ...store.activeSession,
      status: store.activeSession.status === 'active' ? 'cancelled' : store.activeSession.status,
      cancelledAt: store.activeSession.status === 'active' ? now : store.activeSession.cancelledAt,
      updatedAt: now,
    };
    store.completedSessions.push(retained);
    store.completedSessions = store.completedSessions.slice(-COMPLETED_SESSION_LIMIT);
  }
  store.activeSession = normalizeSession({
    id: randomUUID(),
    status: 'active',
    currentPage: SETUP_PAGE_IDS[0],
    pages: {},
    createdAt: now,
    updatedAt: now,
  });
  saveSetupSessionStore(store, options);
  return store.activeSession;
}

export function updateSetupSession(mutator, options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession || store.activeSession.status !== 'active') {
    throw new Error('No active setup session exists.');
  }
  const next = mutator(clone(store.activeSession));
  store.activeSession = normalizeSession({ ...next, updatedAt: new Date().toISOString() });
  saveSetupSessionStore(store, options);
  return store.activeSession;
}

export function cancelSetupSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) return null;
  const now = new Date().toISOString();
  const cancelled = normalizeSession({
    ...store.activeSession,
    status: 'cancelled',
    cancelledAt: now,
    updatedAt: now,
  });
  store.completedSessions.push(cancelled);
  store.completedSessions = store.completedSessions.slice(-COMPLETED_SESSION_LIMIT);
  store.activeSession = null;
  saveSetupSessionStore(store, options);
  return cancelled;
}

export function completeSetupSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  const unfinished = SETUP_PAGE_IDS.filter((pageId) => store.activeSession.pages[pageId]?.completed !== true);
  if (unfinished.length) throw new Error(`Setup cannot complete while pages are incomplete: ${unfinished.join(', ')}.`);
  const now = new Date().toISOString();
  const completed = normalizeSession({
    ...store.activeSession,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  });
  store.completedSessions.push(completed);
  store.completedSessions = store.completedSessions.slice(-COMPLETED_SESSION_LIMIT);
  store.activeSession = null;
  saveSetupSessionStore(store, options);
  return completed;
}

export function saveSetupPage(pageId, input = {}, options = {}) {
  if (!SETUP_PAGE_IDS.includes(pageId)) throw new Error(`Unknown setup page: ${pageId}.`);
  assertNoSecrets(input);
  return updateSetupSession((session) => {
    if (input.repository) {
      const repository = normalizeRepositoryIdentity(input.repository);
      if (session.repository) {
        const current = `${session.repository.owner}/${session.repository.name}`.toLowerCase();
        const next = `${repository.owner}/${repository.name}`.toLowerCase();
        if (current !== next) throw new Error('A setup session cannot switch repositories. Restart setup for another repository.');
      }
      session.repository = repository;
    }
    if (Object.hasOwn(input, 'baseBranch')) session.baseBranch = input.baseBranch ? String(input.baseBranch) : null;
    if (Object.hasOwn(input, 'managedCheckout')) session.managedCheckout = input.managedCheckout ? clone(input.managedCheckout) : null;
    const prior = session.pages[pageId] || normalizePage();
    const selections = input.selections && typeof input.selections === 'object'
      ? { ...prior.selections, ...clone(input.selections) }
      : prior.selections;
    assertNoSecrets(selections);
    session.pages[pageId] = normalizePage({
      ...prior,
      selections,
      completed: input.completed === true ? prior.lastCheck?.ok === true : prior.completed,
      updatedAt: new Date().toISOString(),
    });
    return session;
  }, options);
}

export function recordSetupPageCheck(pageId, result, options = {}) {
  if (!SETUP_PAGE_IDS.includes(pageId)) throw new Error(`Unknown setup page: ${pageId}.`);
  const check = normalizeCheck(result);
  return updateSetupSession((session) => {
    const prior = session.pages[pageId] || normalizePage();
    session.pages[pageId] = normalizePage({
      ...prior,
      lastCheck: check,
      completed: check?.ok === true,
      updatedAt: new Date().toISOString(),
    });
    return session;
  }, options);
}

export function navigateSetupSession(direction, options = {}) {
  if (!['forward', 'back'].includes(direction)) throw new Error('Setup navigation direction must be forward or back.');
  return updateSetupSession((session) => {
    const index = SETUP_PAGE_IDS.indexOf(session.currentPage);
    if (direction === 'back') {
      session.currentPage = SETUP_PAGE_IDS[Math.max(0, index - 1)];
      return session;
    }
    if (session.pages[session.currentPage]?.completed !== true) {
      throw new Error(`Setup page ${session.currentPage} must pass its requirements before continuing.`);
    }
    session.currentPage = SETUP_PAGE_IDS[Math.min(SETUP_PAGE_IDS.length - 1, index + 1)];
    return session;
  }, options);
}
