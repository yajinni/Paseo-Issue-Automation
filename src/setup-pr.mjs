import { existsSync } from 'node:fs';
import path from 'node:path';
import { run, runJson } from './process.mjs';
import {
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  saveRuntime,
} from './state.mjs';

export const SETUP_PULL_REQUEST_BRANCH = 'ai/install-paseo-automation';
export const SETUP_COMMIT_FILES = Object.freeze([
  '.github/ISSUE_TEMPLATE/automated-coding-task.md',
  'paseo.json',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);

const SETUP_COMMIT_FILE_SET = new Set(SETUP_COMMIT_FILES);

function normalizedPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function parsePorcelainStatus(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const file = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
      return { status, path: normalizedPath(file.replace(/^"|"$/g, '')) };
    });
}

function currentBranch(root, runner = run) {
  return runner('git', ['branch', '--show-current'], { cwd: root }).stdout;
}

export function setupChangeStatus(root, { runner = run } = {}) {
  const result = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    allowFailure: true,
  });
  if (!result.ok) {
    return {
      available: false,
      currentBranch: null,
      changedFiles: [],
      expectedFiles: [],
      unexpectedFiles: [],
      reason: result.stderr || result.stdout || 'Git status failed.',
    };
  }
  const entries = parsePorcelainStatus(result.stdout);
  const changedFiles = [...new Set(entries.map((entry) => entry.path))].sort();
  const expectedFiles = changedFiles.filter((file) => SETUP_COMMIT_FILE_SET.has(file));
  const unexpectedFiles = changedFiles.filter((file) => !SETUP_COMMIT_FILE_SET.has(file));
  return {
    available: true,
    currentBranch: currentBranch(root, runner),
    entries,
    changedFiles,
    expectedFiles,
    unexpectedFiles,
    reason: null,
  };
}

function branchExists(root, branch, runner = run) {
  const local = runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  });
  if (local.ok) return true;
  return runner('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  }).ok;
}

function timestampSuffix(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase();
}

function chooseBranch(root, runner, now) {
  if (!branchExists(root, SETUP_PULL_REQUEST_BRANCH, runner)) return SETUP_PULL_REQUEST_BRANCH;
  return `${SETUP_PULL_REQUEST_BRANCH}-${timestampSuffix(now)}`;
}

function ensureGitIdentity(root, runner = run) {
  const name = runner('git', ['config', '--get', 'user.name'], { cwd: root, allowFailure: true });
  const email = runner('git', ['config', '--get', 'user.email'], { cwd: root, allowFailure: true });
  if (!name.ok || !name.stdout || !email.ok || !email.stdout) {
    throw new Error('Git user.name and user.email must be configured before Paseo can create the setup commit.');
  }
}

export function preflightSetupPullRequest(root, { runner = run } = {}) {
  const config = loadConfig(root);
  if (!config.baseBranch) throw new Error('Select the base branch before installing repository components.');
  const changes = setupChangeStatus(root, { runner });
  if (!changes.available) throw new Error(changes.reason || 'Git status is unavailable.');
  if (changes.currentBranch !== config.baseBranch) {
    throw new Error(`Repository components must be installed from the configured base branch ${config.baseBranch}; current branch is ${changes.currentBranch || 'detached HEAD'}.`);
  }
  if (changes.unexpectedFiles.length) {
    throw new Error(`Automatic setup PR creation stopped because unrelated working-tree changes are present: ${changes.unexpectedFiles.join(', ')}.`);
  }
  const existing = loadIntegration(root).setupPullRequest;
  if (existing && existing.state === 'open') {
    throw new Error(`Setup PR #${existing.number} is already open.`);
  }
  ensureGitIdentity(root, runner);
  return { ok: true, baseBranch: config.baseBranch, changes };
}

function normalizePrSnapshot(pr, previous = {}) {
  if (!pr) return previous;
  const merged = Boolean(pr.mergedAt);
  const state = merged ? 'merged' : String(pr.state || '').toLowerCase() === 'open' ? 'open' : 'closed';
  return {
    ...previous,
    number: Number(pr.number || previous.number),
    url: pr.url || previous.url || null,
    branch: pr.headRefName || previous.branch || null,
    baseBranch: pr.baseRefName || previous.baseBranch || null,
    headSha: pr.headRefOid || previous.headSha || null,
    state,
    mergedAt: pr.mergedAt || previous.mergedAt || null,
    checkedAt: new Date().toISOString(),
  };
}

export function reconcileSetupPullRequest(root, { runner = run, jsonRunner = runJson } = {}) {
  const integration = loadIntegration(root);
  const existing = integration.setupPullRequest;
  if (!existing?.number) return null;
  const pr = jsonRunner('gh', [
    'pr', 'view', String(existing.number),
    '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
  ], { cwd: root, allowFailure: true });
  if (!pr) return existing;
  const next = normalizePrSnapshot(pr, existing);

  if (next.state === 'merged' && !next.syncedAt) {
    const status = setupChangeStatus(root, { runner });
    const branch = status.currentBranch;
    if (status.available && status.changedFiles.length === 0 && [next.baseBranch, next.branch].includes(branch)) {
      if (branch === next.branch) {
        runner('git', ['switch', next.baseBranch], { cwd: root });
      }
      const pull = runner('git', ['pull', '--ff-only', 'origin', next.baseBranch], { cwd: root, allowFailure: true });
      if (pull.ok) {
        next.syncedAt = new Date().toISOString();
        next.syncError = null;
      } else {
        next.syncError = pull.stderr || pull.stdout || 'Could not fast-forward the local base branch.';
      }
    } else if (branch !== next.baseBranch) {
      next.syncError = `Switch to ${next.baseBranch} with a clean working tree to finish setup synchronization.`;
    } else if (status.changedFiles.length) {
      next.syncError = 'The setup PR merged, but local changes prevent automatic base-branch synchronization.';
    }
  }

  saveIntegration(root, { ...integration, setupPullRequest: next });
  return next;
}

export function createSetupPullRequest(root, {
  runner = run,
  jsonRunner = runJson,
  now = new Date(),
} = {}) {
  const preflight = preflightSetupPullRequest(root, { runner });
  const changes = setupChangeStatus(root, { runner });
  if (!changes.expectedFiles.length) {
    return { created: false, reason: 'No package-managed repository changes need a pull request.' };
  }
  if (changes.unexpectedFiles.length) {
    throw new Error(`Automatic setup PR creation stopped because unrelated working-tree changes are present: ${changes.unexpectedFiles.join(', ')}.`);
  }

  const branch = chooseBranch(root, runner, now);
  const baseBranch = preflight.baseBranch;
  let committed = false;
  let pushed = false;
  let prCreated = false;
  try {
    runner('git', ['switch', '-c', branch], { cwd: root });
    runner('git', ['add', '--', ...changes.expectedFiles], { cwd: root });
    const staged = runner('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout
      .split(/\r?\n/)
      .map(normalizedPath)
      .filter(Boolean)
      .sort();
    if (!staged.length) throw new Error('No setup files were staged for the automatic setup PR.');
    const unexpectedStaged = staged.filter((file) => !SETUP_COMMIT_FILE_SET.has(file));
    if (unexpectedStaged.length) throw new Error(`Refusing to commit unexpected files: ${unexpectedStaged.join(', ')}.`);

    runner('git', ['commit', '-m', 'Install Paseo issue automation'], { cwd: root });
    committed = true;
    const headSha = runner('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout;
    runner('git', ['push', '--set-upstream', 'origin', branch], { cwd: root });
    pushed = true;
    runner('gh', [
      'pr', 'create',
      '--base', baseBranch,
      '--head', branch,
      '--title', 'Install Paseo issue automation',
      '--body', [
        '## Summary',
        '',
        'Install the repository-managed files required by Paseo issue automation.',
        '',
        '## Included files',
        '',
        ...staged.map((file) => `- \`${file}\``),
        '',
        'GitHub lifecycle labels and the machine-local Paseo workspace are managed separately and are not part of this commit.',
      ].join('\n'),
    ], { cwd: root });
    prCreated = true;
    const pr = jsonRunner('gh', [
      'pr', 'view', branch,
      '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
    ], { cwd: root });
    if (!pr?.number || !pr?.url) throw new Error('GitHub created the setup PR, but its metadata could not be read.');

    const integration = loadIntegration(root);
    const setupPullRequest = {
      ...normalizePrSnapshot(pr),
      branch,
      baseBranch,
      headSha,
      files: staged,
      createdAt: new Date().toISOString(),
      syncedAt: null,
      syncError: null,
    };
    saveIntegration(root, { ...integration, setupPullRequest });
    saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
    saveConfig(root, { ...loadConfig(root), setupComplete: false });

    const switched = runner('git', ['switch', baseBranch], { cwd: root, allowFailure: true });
    return {
      created: true,
      pullRequest: setupPullRequest,
      returnedToBaseBranch: switched.ok,
      switchError: switched.ok ? null : switched.stderr || switched.stdout || null,
    };
  } catch (error) {
    const status = setupChangeStatus(root, { runner });
    if (!committed && status.currentBranch === branch) {
      runner('git', ['switch', baseBranch], { cwd: root, allowFailure: true });
      runner('git', ['branch', '-D', branch], { cwd: root, allowFailure: true });
    }
    error.setupBranch = branch;
    error.setupCommitCreated = committed;
    error.setupBranchPushed = pushed;
    error.setupPullRequestCreated = prCreated;
    throw error;
  }
}

export function setupPullRequestBlocksSetup(setupPullRequest) {
  if (!setupPullRequest) return false;
  return setupPullRequest.state !== 'merged' || !setupPullRequest.syncedAt;
}

export function expectedSetupFileExists(root, file) {
  return existsSync(path.join(root, file));
}
