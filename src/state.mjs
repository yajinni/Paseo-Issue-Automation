import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEGACY_LABELS } from './label-catalog.mjs';
import { run } from './process.mjs';
import {
  DEFAULT_REPOSITORY_CONFIG,
  validateRepositoryConfig,
} from './setup-wizard/schema.mjs';

export const WORKSPACE_TITLE = 'Issue Coding Automation';

// Compatibility accessor for legacy runtime/install code. New lifecycle work should use label-catalog.mjs.
export const LABELS = LEGACY_LABELS;

export const DEFAULT_CONFIG = Object.freeze({
  ...DEFAULT_REPOSITORY_CONFIG,
  workspace: { id: null, title: WORKSPACE_TITLE },
});

export const DEFAULT_RUNTIME = Object.freeze({
  claimsEnabled: false,
  lastDispatchAt: null,
  lastDispatchResult: null,
  skippedIssueNumbers: [],
});

export const DEFAULT_INTEGRATION = Object.freeze({
  version: 2,
  issueTemplate: null,
  paseoJson: null,
  labels: {},
  workspace: null,
});

const LIFECYCLE_TEXT_LIMIT = 4_000;
const TRACKED_RUN_FIELDS = Object.freeze([
  'attempt', 'status', 'phase', 'branch', 'workspaceId', 'worktreePath', 'coderAgentId', 'agentId',
  'controllerPid', 'prNumber', 'prUrl', 'reason', 'startedAt', 'completedAt', 'heartbeatAt',
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function lifecycleSafeText(value) {
  const text = String(value ?? '')
    .replace(/\b(password|secret|token|api[-_]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  return text.length <= LIFECYCLE_TEXT_LIMIT ? text : `${text.slice(0, LIFECYCLE_TEXT_LIMIT)}…`;
}

function lifecycleValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  return lifecycleSafeText(value);
}

export function repositoryRoot(cwd = process.cwd()) {
  const result = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  return path.resolve(result.stdout);
}

export function statePaths(root) {
  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd: root }).stdout;
  const gitDir = path.resolve(root, common);
  const stateRoot = path.join(gitDir, 'paseo-issue-automation');
  const runs = path.join(stateRoot, 'runs');
  const lifecycle = path.join(stateRoot, 'lifecycle');
  mkdirSync(runs, { recursive: true });
  mkdirSync(lifecycle, { recursive: true });
  return {
    root: stateRoot,
    config: path.join(stateRoot, 'config.json'),
    runtime: path.join(stateRoot, 'runtime.json'),
    integration: path.join(stateRoot, 'integration.json'),
    runs,
    lifecycle,
  };
}

export function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, file);
}

function readJson(file, fallback) {
  if (!existsSync(file)) return clone(fallback);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function validateConfig(input = {}) {
  return validateRepositoryConfig(input, { workspaceTitle: WORKSPACE_TITLE });
}

export function loadConfig(root) {
  const file = statePaths(root).config;
  const stored = readJson(file, DEFAULT_CONFIG);
  return validateConfig(stored);
}

export function saveConfig(root, input) {
  const config = validateConfig(input);
  atomicWrite(statePaths(root).config, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function loadRuntime(root) {
  const stored = readJson(statePaths(root).runtime, DEFAULT_RUNTIME);
  return {
    ...clone(DEFAULT_RUNTIME),
    ...stored,
    skippedIssueNumbers: [...new Set((stored.skippedIssueNumbers || []).map(Number).filter(Number.isInteger))],
  };
}

export function saveRuntime(root, runtime) {
  const normalized = {
    claimsEnabled: runtime.claimsEnabled === true,
    lastDispatchAt: runtime.lastDispatchAt || null,
    lastDispatchResult: runtime.lastDispatchResult || null,
    skippedIssueNumbers: [...new Set((runtime.skippedIssueNumbers || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b),
  };
  atomicWrite(statePaths(root).runtime, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function loadIntegration(root) {
  const stored = readJson(statePaths(root).integration, DEFAULT_INTEGRATION);
  return {
    version: 2,
    issueTemplate: stored.issueTemplate || null,
    paseoJson: stored.paseoJson || null,
    labels: stored.labels && typeof stored.labels === 'object' ? stored.labels : {},
    workspace: stored.workspace || null,
  };
}

export function saveIntegration(root, integration) {
  const normalized = {
    version: 2,
    issueTemplate: integration.issueTemplate || null,
    paseoJson: integration.paseoJson || null,
    labels: integration.labels && typeof integration.labels === 'object' ? integration.labels : {},
    workspace: integration.workspace || null,
  };
  atomicWrite(statePaths(root).integration, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function runFile(root, issueNumber) {
  return path.join(statePaths(root).runs, `issue-${Number(issueNumber)}.json`);
}

export function issueLifecycleFile(root, issueNumber) {
  return path.join(statePaths(root).lifecycle, `issue-${Number(issueNumber)}.jsonl`);
}

export function appendIssueLifecycle(root, issueNumber, input = {}) {
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number <= 0) throw new Error('A positive issue number is required for lifecycle logging.');
  const event = {
    id: input.id || randomUUID(),
    at: input.at || new Date().toISOString(),
    issueNumber: number,
    attempt: Number.isInteger(Number(input.attempt)) ? Number(input.attempt) : null,
    type: lifecycleSafeText(input.type || 'activity'),
    status: lifecycleSafeText(input.status || 'info'),
    source: lifecycleSafeText(input.source || 'controller'),
    message: lifecycleSafeText(input.message || input.type || 'Issue lifecycle event'),
    evidence: input.evidence && typeof input.evidence === 'object'
      ? Object.fromEntries(Object.entries(input.evidence).map(([key, value]) => [key, lifecycleValue(value)]))
      : {},
  };
  appendFileSync(issueLifecycleFile(root, number), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

export function loadIssueLifecycle(root, issueNumber, { limit = 250 } = {}) {
  const file = issueLifecycleFile(root, issueNumber);
  if (!existsSync(file)) return [];
  const maximum = Math.max(1, Math.min(5_000, Number(limit) || 250));
  const events = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
  return events.slice(-maximum);
}

function runStateEvidence(previous, state) {
  const changed = {};
  for (const key of TRACKED_RUN_FIELDS) {
    const before = previous?.[key] ?? null;
    const after = state?.[key] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changed[key] = `${lifecycleValue(before)} -> ${lifecycleValue(after)}`;
  }
  return changed;
}

function gitValue(cwd, args) {
  const result = run('git', args, { cwd, allowFailure: true });
  return result.ok ? String(result.stdout || '').trim() || null : null;
}

function baseFreshnessEvidence(root, state) {
  const baseBranch = loadConfig(root).baseBranch;
  const cwd = state?.worktreePath || root;
  const baseRef = `refs/remotes/origin/${baseBranch}`;
  const headSha = gitValue(cwd, ['rev-parse', 'HEAD']);
  const baseSha = gitValue(cwd, ['rev-parse', baseRef]);
  const mergeBase = gitValue(cwd, ['merge-base', baseRef, 'HEAD']);
  const ancestorResult = run('git', ['merge-base', '--is-ancestor', baseRef, 'HEAD'], { cwd, allowFailure: true });
  const counts = gitValue(cwd, ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`]);
  const [behind, ahead] = String(counts || '').trim().split(/\s+/).map(Number);
  return {
    baseBranch,
    baseRef,
    baseSha,
    headSha,
    mergeBase,
    baseIsAncestor: ancestorResult.ok,
    behind: Number.isFinite(behind) ? behind : null,
    ahead: Number.isFinite(ahead) ? ahead : null,
  };
}

function appendRunLifecycleDelta(root, issueNumber, previous, state) {
  const attempt = state?.attempt || previous?.attempt || null;
  const changed = runStateEvidence(previous, state);
  if (!previous || Object.keys(changed).length) {
    appendIssueLifecycle(root, issueNumber, {
      attempt,
      type: previous ? 'run-state-changed' : 'run-created',
      status: 'success',
      source: 'state',
      message: previous ? 'Recorded issue run state changed.' : 'Created issue automation run state.',
      evidence: changed,
    });
  }

  const previousActivityCount = Array.isArray(previous?.activity) ? previous.activity.length : 0;
  const activity = Array.isArray(state?.activity) ? state.activity.slice(previousActivityCount) : [];
  for (const item of activity) {
    const evidence = {
      phase: state?.phase || null,
      status: state?.status || null,
      branch: state?.branch || null,
      workspaceId: state?.workspaceId || null,
      coderAgentId: state?.coderAgentId || state?.agentId || null,
      controllerPid: state?.controllerPid || null,
      prNumber: state?.prNumber || null,
    };
    if (item?.type === 'base-update-required') Object.assign(evidence, baseFreshnessEvidence(root, state));
    appendIssueLifecycle(root, issueNumber, {
      at: item?.at,
      attempt,
      type: item?.type || 'activity',
      status: String(item?.type || '').includes('failed') ? 'failed' : 'success',
      source: 'activity',
      message: item?.details || item?.detail || item?.message || item?.type || 'Issue activity',
      evidence,
    });
  }

  const previousEventCount = Array.isArray(previous?.events) ? previous.events.length : 0;
  const events = Array.isArray(state?.events) ? state.events.slice(previousEventCount) : [];
  for (const item of events) {
    appendIssueLifecycle(root, issueNumber, {
      at: item?.at || item?.updatedAt || item?.createdAt,
      attempt,
      type: item?.event || item?.type || 'controller-event',
      status: item?.result || 'success',
      source: 'event',
      message: item?.details || item?.summary || item?.message || item?.reason || item?.event || 'Controller event',
      evidence: {
        result: item?.result || null,
        commit: item?.commit || item?.headSha || null,
        stage: item?.stage || null,
        round: item?.round || null,
      },
    });
  }
}

export function loadRun(root, issueNumber) { return readJson(runFile(root, issueNumber), null); }

export function saveRun(root, issueNumber, state) {
  const previous = loadRun(root, issueNumber);
  atomicWrite(runFile(root, issueNumber), `${JSON.stringify(state, null, 2)}\n`);
  try { appendRunLifecycleDelta(root, issueNumber, previous, state); } catch {}
  return state;
}

export function removeRun(root, issueNumber) {
  // Intentionally preserve the append-only lifecycle log so operator diagnostics survive run resets.
  rmSync(runFile(root, issueNumber), { force: true });
}

export function listRuns(root) {
  const directory = statePaths(root).runs;
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^issue-\d+\.json$/.test(entry.name))
    .map((entry) => readJson(path.join(directory, entry.name), null))
    .filter(Boolean)
    .sort((a, b) => Number(a.issueNumber) - Number(b.issueNumber));
}
