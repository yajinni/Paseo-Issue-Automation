import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { PR_REVIEW_LABELS } from './label-catalog.mjs';
import { atomicWrite, statePaths } from './state.mjs';
import {
  DEFAULT_REVIEW_PROMPT_TEMPLATE,
  REVIEW_PROMPT_VERSION,
  validateReviewPromptTemplate,
} from './review-prompt.mjs';

export { PR_REVIEW_LABELS };

export const MANAGED_PR_STATES = Object.freeze([
  'queued',
  'submitting',
  'awaiting_result',
  'changes_requested',
  'fix_queued',
  'fixing',
  'awaiting_new_sha',
  'ready_to_merge',
  'merged',
  'closed_unmerged',
  'paused',
  'failed',
]);

export const REVIEW_JOB_STATES = Object.freeze([
  'queued',
  'submitting',
  'awaiting_result',
  'completed',
  'superseded',
  'paused',
  'cancelled',
  'failed',
]);

export const FIX_JOB_STATES = Object.freeze([
  'queued',
  'fixing',
  'completed',
  'paused',
  'cancelled',
  'failed',
  'interrupted',
]);

export const DEFAULT_PR_AUTOMATION_CONFIG = Object.freeze({
  enabled: false,
  browserReview: {
    enabled: false,
    projectConversationUrl: null,
    reviewPromptTemplate: DEFAULT_REVIEW_PROMPT_TEMPLATE,
    reviewPromptVersion: REVIEW_PROMPT_VERSION,
    reviewDebounceMs: 15_000,
    maxSubmissionAttempts: 3,
  },
  reviewQueue: {
    concurrency: 1,
    paused: true,
  },
  reconciliation: {
    enabled: true,
    activeIntervalMs: 45_000,
    idleIntervalMs: 300_000,
  },
  githubActions: {
    allowChatGPTMerge: false,
    verifyIssueClosure: true,
    allowPaseoIssueClosureFallback: false,
  },
});

const STORE_VERSION = 1;
const STORE_LOCK_TTL_MS = 300_000;
const STORE_LOCK_RETRIES = 200;
const STORE_LOCK_DELAY_MS = 25;
const HISTORY_LIMIT = 10_000;

export const TERMINAL_PR_STATES = new Set(['merged', 'closed_unmerged']);
export const TERMINAL_REVIEW_JOB_STATES = new Set(['completed', 'superseded', 'cancelled']);
export const TERMINAL_FIX_JOB_STATES = new Set(['completed', 'cancelled']);

export function nowIso(now = Date.now()) {
  return new Date(typeof now === 'number' ? now : now.getTime()).toISOString();
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function integer(value, fallback, min, max, label) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}.`);
  }
  return normalized;
}

function optionalUrl(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function validatePrAutomationConfig(input = {}) {
  const browser = input.browserReview || {};
  const queue = input.reviewQueue || {};
  const reconciliation = input.reconciliation || {};
  const githubActions = input.githubActions || {};
  return {
    enabled: input.enabled === true,
    browserReview: {
      enabled: browser.enabled === true,
      projectConversationUrl: optionalUrl(browser.projectConversationUrl),
      reviewPromptTemplate: validateReviewPromptTemplate(browser.reviewPromptTemplate || DEFAULT_REVIEW_PROMPT_TEMPLATE),
      reviewPromptVersion: integer(browser.reviewPromptVersion, REVIEW_PROMPT_VERSION, 1, 10_000, 'Review prompt version'),
      reviewDebounceMs: integer(browser.reviewDebounceMs, 15_000, 0, 600_000, 'Review debounce'),
      maxSubmissionAttempts: integer(browser.maxSubmissionAttempts, 3, 1, 10, 'Maximum submission attempts'),
    },
    reviewQueue: {
      concurrency: 1,
      paused: queue.paused !== false,
    },
    reconciliation: {
      enabled: reconciliation.enabled !== false,
      activeIntervalMs: integer(reconciliation.activeIntervalMs, 45_000, 10_000, 3_600_000, 'Active reconciliation interval'),
      idleIntervalMs: integer(reconciliation.idleIntervalMs, 300_000, 30_000, 86_400_000, 'Idle reconciliation interval'),
    },
    githubActions: {
      allowChatGPTMerge: githubActions.allowChatGPTMerge === true,
      verifyIssueClosure: githubActions.verifyIssueClosure !== false,
      allowPaseoIssueClosureFallback: githubActions.allowPaseoIssueClosureFallback === true,
    },
  };
}

function defaultStore() {
  return {
    version: STORE_VERSION,
    config: validatePrAutomationConfig(DEFAULT_PR_AUTOMATION_CONFIG),
    managedPullRequests: [],
    reviewJobs: [],
    fixJobs: [],
    runtime: {
      activeReviewJobId: null,
      lastReconciledAt: null,
      lastReconciliationResult: null,
      nextQueuePosition: 1,
    },
    history: [],
  };
}

export function prReviewPaths(root) {
  const stateRoot = statePaths(root).root;
  const diagnostics = path.join(stateRoot, 'pr-review-diagnostics');
  mkdirSync(diagnostics, { recursive: true, mode: 0o700 });
  try { chmodSync(diagnostics, 0o700); } catch {}
  return {
    store: path.join(stateRoot, 'pr-review.json'),
    lock: path.join(stateRoot, 'pr-review.lock'),
    diagnostics,
  };
}

function readJson(file, fallback) {
  if (!existsSync(file)) return clone(fallback);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function normalizeManagedPullRequest(record) {
  const reviewState = MANAGED_PR_STATES.includes(record.reviewState) ? record.reviewState : 'queued';
  return {
    id: String(record.id),
    repository: String(record.repository),
    issueNumber: Number(record.issueNumber),
    issueUrl: record.issueUrl || null,
    pullRequestNumber: Number(record.pullRequestNumber),
    pullRequestUrl: String(record.pullRequestUrl),
    branchName: String(record.branchName),
    baseBranch: record.baseBranch ? String(record.baseBranch) : null,
    worktreePath: record.worktreePath || null,
    workspaceId: record.workspaceId || null,
    coderAgentId: record.coderAgentId || null,
    currentHeadSha: String(record.currentHeadSha),
    lastSubmittedReviewSha: record.lastSubmittedReviewSha || null,
    lastCompletedReviewSha: record.lastCompletedReviewSha || null,
    lastValidatedReviewSha: record.lastValidatedReviewSha || null,
    reviewRound: Math.max(1, Number(record.reviewRound) || 1),
    reviewPromptVersion: Math.max(1, Number(record.reviewPromptVersion) || REVIEW_PROMPT_VERSION),
    stagedReviewEvents: Array.isArray(record.stagedReviewEvents)
      ? clone(record.stagedReviewEvents).slice(-100)
      : [],
    reviewState,
    queuePosition: record.queuePosition === null || record.queuePosition === undefined
      ? null
      : Number.isFinite(Number(record.queuePosition)) ? Number(record.queuePosition) : null,
    priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : 0,
    activeReviewRequestId: record.activeReviewRequestId || null,
    lastReviewCommentId: record.lastReviewCommentId || null,
    lastProcessedReviewRequestId: record.lastProcessedReviewRequestId || null,
    conversationUrlOverride: record.conversationUrlOverride || null,
    createdAt: record.createdAt || nowIso(),
    updatedAt: record.updatedAt || record.createdAt || nowIso(),
    lastReconciledAt: record.lastReconciledAt || null,
    lastActivityAt: record.lastActivityAt || record.updatedAt || null,
    lastError: record.lastError || null,
    issueClosurePending: record.issueClosurePending === true,
    lifecycleCompletionPending: record.lifecycleCompletionPending === true,
    issueLifecycleLabelsClearedAt: record.issueLifecycleLabelsClearedAt || null,
    reviewEvidenceMissing: record.reviewEvidenceMissing === true,
    diagnosticScreenshot: record.diagnosticScreenshot || null,
    provenance: record.provenance && typeof record.provenance === 'object'
      ? clone(record.provenance)
      : null,
  };
}

export function normalizeReviewJob(job) {
  return {
    id: String(job.id),
    managedPullRequestId: String(job.managedPullRequestId),
    repository: String(job.repository),
    pullRequestNumber: Number(job.pullRequestNumber),
    headSha: String(job.headSha),
    promptVersion: Math.max(1, Number(job.promptVersion) || REVIEW_PROMPT_VERSION),
    reviewRound: Math.max(1, Number(job.reviewRound) || 1),
    reviewRequestId: String(job.reviewRequestId),
    state: REVIEW_JOB_STATES.includes(job.state) ? job.state : 'queued',
    queuePosition: Number(job.queuePosition) || 0,
    priority: Number(job.priority) || 0,
    dueAt: job.dueAt || nowIso(),
    attempts: Math.max(0, Number(job.attempts) || 0),
    conversationUrlOverride: job.conversationUrlOverride || null,
    conversationUrlUsed: job.conversationUrlUsed || null,
    submittedAt: job.submittedAt || null,
    completedAt: job.completedAt || null,
    result: job.result || null,
    resultSourceId: job.resultSourceId ?? null,
    lastError: job.lastError || null,
    diagnosticScreenshot: job.diagnosticScreenshot || null,
    createdAt: job.createdAt || nowIso(),
    updatedAt: job.updatedAt || job.createdAt || nowIso(),
  };
}

export function normalizeFixJob(job) {
  return {
    id: String(job.id),
    managedPullRequestId: String(job.managedPullRequestId),
    reviewJobId: String(job.reviewJobId),
    reviewRequestId: String(job.reviewRequestId),
    sourceReviewRound: Number.isInteger(Number(job.sourceReviewRound)) && Number(job.sourceReviewRound) > 0
      ? Number(job.sourceReviewRound)
      : null,
    sourceReviewCommentId: job.sourceReviewCommentId ?? null,
    repository: String(job.repository),
    pullRequestNumber: Number(job.pullRequestNumber),
    issueNumber: Number(job.issueNumber),
    branchName: String(job.branchName),
    reviewedHeadSha: String(job.reviewedHeadSha),
    findings: String(job.findings || ''),
    state: FIX_JOB_STATES.includes(job.state) ? job.state : 'queued',
    priority: Number(job.priority) || 0,
    attempts: Math.max(0, Number(job.attempts) || 0),
    workerLease: job.workerLease || null,
    coderAgentId: job.coderAgentId || null,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    newHeadSha: job.newHeadSha || null,
    lastError: job.lastError || null,
    createdAt: job.createdAt || nowIso(),
    updatedAt: job.updatedAt || job.createdAt || nowIso(),
  };
}

function normalizeStore(value) {
  const fallback = defaultStore();
  const store = value && typeof value === 'object' ? value : fallback;
  const storedConfig = store.config && typeof store.config === 'object' ? store.config : {};
  const hasPersistedQueueState = Object.hasOwn(storedConfig, 'reviewQueue');
  const reviewQueue = hasPersistedQueueState
    ? { ...fallback.config.reviewQueue, ...(storedConfig.reviewQueue || {}) }
    : { ...fallback.config.reviewQueue, paused: storedConfig.enabled !== true };
  return {
    version: STORE_VERSION,
    config: validatePrAutomationConfig({
      ...fallback.config,
      ...storedConfig,
      browserReview: { ...fallback.config.browserReview, ...(storedConfig.browserReview || {}) },
      reviewQueue,
      reconciliation: { ...fallback.config.reconciliation, ...(storedConfig.reconciliation || {}) },
      githubActions: { ...fallback.config.githubActions, ...(storedConfig.githubActions || {}) },
    }),
    managedPullRequests: (store.managedPullRequests || []).map(normalizeManagedPullRequest),
    reviewJobs: (store.reviewJobs || []).map(normalizeReviewJob),
    fixJobs: (store.fixJobs || []).map(normalizeFixJob),
    runtime: {
      activeReviewJobId: store.runtime?.activeReviewJobId || null,
      lastReconciledAt: store.runtime?.lastReconciledAt || null,
      lastReconciliationResult: store.runtime?.lastReconciliationResult || null,
      nextQueuePosition: Math.max(1, Number(store.runtime?.nextQueuePosition) || 1),
    },
    history: Array.isArray(store.history) ? store.history.slice(-HISTORY_LIMIT) : [],
  };
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readStoreLock(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return null; }
}

function staleLock(file, now = Date.now()) {
  const lock = readStoreLock(file);
  return !lock || !lock.expiresAt || Date.parse(lock.expiresAt) <= now || !processAlive(lock.pid);
}

function acquireStoreLock(root) {
  const file = prReviewPaths(root).lock;
  for (let attempt = 0; attempt < STORE_LOCK_RETRIES; attempt += 1) {
    try {
      const descriptor = openSync(file, 'wx', 0o600);
      const at = Date.now();
      const lock = {
        id: `store-lock-${randomUUID()}`,
        pid: process.pid,
        acquiredAt: nowIso(at),
        expiresAt: nowIso(at + STORE_LOCK_TTL_MS),
      };
      writeFileSync(descriptor, JSON.stringify(lock));
      closeSync(descriptor);
      try { chmodSync(file, 0o600); } catch {}
      return () => {
        const current = readStoreLock(file);
        if (current?.id === lock.id) rmSync(file, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (staleLock(file)) {
        const stale = readStoreLock(file);
        const current = readStoreLock(file);
        if (!stale || current?.id === stale.id) rmSync(file, { force: true });
        continue;
      }
      sleepSync(STORE_LOCK_DELAY_MS);
    }
  }
  throw new Error('Timed out waiting for the PR-review state lock.');
}

export function loadPrReviewStore(root) {
  return normalizeStore(readJson(prReviewPaths(root).store, defaultStore()));
}

export function savePrReviewStore(root, input) {
  const store = normalizeStore(input);
  atomicWrite(prReviewPaths(root).store, `${JSON.stringify(store, null, 2)}\n`);
  try { chmodSync(prReviewPaths(root).store, 0o600); } catch {}
  return store;
}

export function mutatePrReviewStore(root, mutator) {
  const release = acquireStoreLock(root);
  try {
    const store = loadPrReviewStore(root);
    const result = mutator(store);
    savePrReviewStore(root, store);
    return result;
  } finally {
    release();
  }
}

export function appendHistory(store, {
  entityType,
  entityId,
  previousState = null,
  newState = null,
  reason,
  actor,
  sha = null,
  error = null,
  timestamp = nowIso(),
}) {
  store.history.push({
    id: `history-${randomUUID()}`,
    entityType,
    entityId,
    previousState,
    newState,
    reason: String(reason || ''),
    actor: String(actor || 'controller'),
    sha: sha || null,
    timestamp,
    error: error ? String(error) : null,
  });
  if (store.history.length > HISTORY_LIMIT) store.history.splice(0, store.history.length - HISTORY_LIMIT);
}

export function transitionManaged(store, record, nextState, {
  reason,
  actor = 'controller',
  sha,
  error,
  at = nowIso(),
} = {}) {
  if (!MANAGED_PR_STATES.includes(nextState)) throw new Error(`Unknown managed PR state: ${nextState}`);
  const previousState = record.reviewState;
  record.reviewState = nextState;
  record.updatedAt = at;
  record.lastActivityAt = at;
  record.lastError = error ? String(error) : null;
  appendHistory(store, {
    entityType: 'managed_pull_request',
    entityId: record.id,
    previousState,
    newState: nextState,
    reason,
    actor,
    sha: sha || record.currentHeadSha,
    error,
    timestamp: at,
  });
}

export function findManaged(store, id) {
  return store.managedPullRequests.find((record) => record.id === id) || null;
}

export function findReviewJob(store, id) {
  return store.reviewJobs.find((job) => job.id === id) || null;
}

export function findFixJob(store, id) {
  return store.fixJobs.find((job) => job.id === id) || null;
}

export function managedPullRequestId(repository, pullRequestNumber) {
  const normalizedRepository = String(repository || '').trim().toLowerCase();
  const normalizedPr = Number(pullRequestNumber);
  if (!normalizedRepository || !Number.isInteger(normalizedPr) || normalizedPr < 1) {
    throw new Error('Repository and pull request number are required.');
  }
  return `${normalizedRepository}#${normalizedPr}`;
}

export function nextQueuePosition(store) {
  const value = store.runtime.nextQueuePosition;
  store.runtime.nextQueuePosition += 1;
  return value;
}

export function savePrAutomationConfig(root, input) {
  return mutatePrReviewStore(root, (store) => {
    store.config = validatePrAutomationConfig({
      ...store.config,
      ...input,
      browserReview: { ...store.config.browserReview, ...(input.browserReview || {}) },
      reviewQueue: { ...store.config.reviewQueue, ...(input.reviewQueue || {}) },
      reconciliation: { ...store.config.reconciliation, ...(input.reconciliation || {}) },
      githubActions: { ...store.config.githubActions, ...(input.githubActions || {}) },
    });
    appendHistory(store, {
      entityType: 'configuration',
      entityId: 'pr-automation',
      reason: 'PR automation configuration updated.',
      actor: 'user',
    });
    return clone(store.config);
  });
}

export function setReviewQueuePaused(root, paused) {
  return savePrAutomationConfig(root, { reviewQueue: { paused: paused === true } });
}

export function recordReconciliation(root, result, { now = Date.now() } = {}) {
  return mutatePrReviewStore(root, (store) => {
    store.runtime.lastReconciledAt = nowIso(now);
    store.runtime.lastReconciliationResult = result || null;
    return clone(store.runtime);
  });
}
