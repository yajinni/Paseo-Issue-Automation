import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './process.mjs';
import {
  DEFAULT_REPOSITORY_CONFIG,
  validateRepositoryConfig,
} from './setup-wizard/schema.mjs';

export const WORKSPACE_TITLE = 'Issue Coding Automation';

export const LABELS = Object.freeze({
  ready: 'agent-ready',
  running: 'agent-running',
  blocked: 'agent-blocked',
  failed: 'agent-failed',
  humanReview: 'human-review',
});

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

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function repositoryRoot(cwd = process.cwd()) {
  const result = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  return path.resolve(result.stdout);
}

export function statePaths(root) {
  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd: root }).stdout;
  const gitDir = path.resolve(root, common);
  const stateRoot = path.join(gitDir, 'paseo-issue-automation');
  const runs = path.join(stateRoot, 'runs');
  mkdirSync(runs, { recursive: true });
  return {
    root: stateRoot,
    config: path.join(stateRoot, 'config.json'),
    runtime: path.join(stateRoot, 'runtime.json'),
    integration: path.join(stateRoot, 'integration.json'),
    runs,
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

export function loadRun(root, issueNumber) { return readJson(runFile(root, issueNumber), null); }

export function saveRun(root, issueNumber, state) {
  atomicWrite(runFile(root, issueNumber), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function removeRun(root, issueNumber) {
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
