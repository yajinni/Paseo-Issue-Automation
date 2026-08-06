import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_MODES, loadControllerMode, saveControllerMode } from './controller-mode.mjs';
import { PASEO_SERVICE, PASEO_SERVICE_NAME } from './install-legacy.mjs';
import { run, runJson } from './process.mjs';
import { loadSetupPullRequest } from './setup-pr.mjs';
import {
  atomicWrite,
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  saveRuntime,
  statePaths,
} from './state.mjs';

export const AUTOMATION_PACKAGE_NAME = 'paseo-issue-automation';
export const MIGRATION_BRANCH = 'ai/migrate-paseo-to-standalone-manager';
export const MIGRATION_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'paseo.json',
]);
const MIGRATION_FILE_SET = new Set(MIGRATION_FILES);
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function migrationFile(root) {
  return path.join(statePaths(root).root, 'external-migration.json');
}

export function loadExternalMigration(root) {
  try {
    const file = migrationFile(root);
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveExternalMigration(root, value) {
  atomicWrite(migrationFile(root), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function dependencyLocation(packageJson, packageName = AUTOMATION_PACKAGE_NAME) {
  for (const section of DEPENDENCY_SECTIONS) {
    if (Object.prototype.hasOwnProperty.call(packageJson?.[section] || {}, packageName)) {
      return { section, specifier: packageJson[section][packageName] };
    }
  }
  return null;
}

export function packageManagerRemoval(root, packageJson = null) {
  const manifest = packageJson || readJson(path.join(root, 'package.json'));
  const declared = String(manifest.packageManager || '').split('@')[0].trim();
  const managers = {
    npm: { command: 'npm', args: ['uninstall', AUTOMATION_PACKAGE_NAME] },
    pnpm: { command: 'pnpm', args: ['remove', AUTOMATION_PACKAGE_NAME] },
    yarn: { command: 'yarn', args: ['remove', AUTOMATION_PACKAGE_NAME] },
    bun: { command: 'bun', args: ['remove', AUTOMATION_PACKAGE_NAME] },
  };
  if (managers[declared]) return { manager: declared, ...managers[declared] };
  const lockMatches = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
    ['npm', 'npm-shrinkwrap.json'],
  ].filter(([, file]) => existsSync(path.join(root, file)));
  const distinct = [...new Set(lockMatches.map(([manager]) => manager))];
  if (distinct.length > 1) {
    throw new Error(`Migration cannot choose a package manager because multiple lockfile families are present: ${distinct.join(', ')}.`);
  }
  const manager = distinct[0] || 'npm';
  return { manager, ...managers[manager] };
}

export function removeManagedPaseoServiceFile(root, integration = loadIntegration(root)) {
  const managed = integration.paseoJson;
  if (managed?.serviceAddedByPackage !== true) {
    throw new Error('The repository service is not recorded as package-managed, so migration will not remove it automatically.');
  }
  const file = path.join(root, managed.path || 'paseo.json');
  if (!existsSync(file)) return { path: path.relative(root, file), changed: false, removedFile: false };
  const existing = readJson(file);
  const currentService = existing.scripts?.[PASEO_SERVICE_NAME];
  if (currentService && !sameJson(currentService, PASEO_SERVICE)) {
    throw new Error(`The ${PASEO_SERVICE_NAME} service changed after installation and must be reviewed manually before migration.`);
  }
  const next = { ...existing, scripts: { ...(existing.scripts || {}) } };
  delete next.scripts[PASEO_SERVICE_NAME];
  if (Object.keys(next.scripts).length === 0) delete next.scripts;
  const removedFile = managed.createdByPackage === true && Object.keys(next).length === 0;
  if (removedFile) rmSync(file);
  else writeJson(file, next);
  return { path: path.relative(root, file), changed: true, removedFile };
}

function gitStatus(root, runner = run) {
  const result = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, allowFailure: true });
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Git status failed.');
  return String(result.stdout || '').trim();
}

function currentBranch(root, runner = run) {
  return runner('git', ['branch', '--show-current'], { cwd: root }).stdout;
}

function ensureGitIdentity(root, runner = run) {
  const name = runner('git', ['config', '--get', 'user.name'], { cwd: root, allowFailure: true });
  const email = runner('git', ['config', '--get', 'user.email'], { cwd: root, allowFailure: true });
  if (!name.ok || !name.stdout || !email.ok || !email.stdout) {
    throw new Error('Git user.name and user.email must be configured before creating the migration PR.');
  }
}

function branchExists(root, branch, runner = run) {
  const local = runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, allowFailure: true });
  if (local.ok) return true;
  return runner('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], { cwd: root, allowFailure: true }).ok;
}

function migrationBranch(root, runner, now) {
  if (!branchExists(root, MIGRATION_BRANCH, runner)) return MIGRATION_BRANCH;
  const suffix = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase();
  return `${MIGRATION_BRANCH}-${suffix}`;
}

function normalizePr(pr, previous = {}) {
  if (!pr) return previous;
  const merged = Boolean(pr.mergedAt);
  return {
    ...previous,
    number: Number(pr.number || previous.number),
    url: pr.url || previous.url || null,
    branch: pr.headRefName || previous.branch || null,
    baseBranch: pr.baseRefName || previous.baseBranch || null,
    headSha: pr.headRefOid || previous.headSha || null,
    state: merged ? 'merged' : String(pr.state || '').toLowerCase() === 'open' ? 'open' : 'closed',
    mergedAt: pr.mergedAt || previous.mergedAt || null,
    checkedAt: new Date().toISOString(),
  };
}

function changedFiles(root, runner = run) {
  return runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, '').replaceAll('\\', '/'))
    .map((file) => file.includes(' -> ') ? file.split(' -> ').at(-1) : file)
    .filter(Boolean)
    .sort();
}

function pauseForMigration(root) {
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  saveConfig(root, { ...loadConfig(root), setupComplete: false });
}

export function createExternalMigrationPullRequest(root, {
  runner = run,
  jsonRunner = runJson,
  now = new Date(),
} = {}) {
  if (loadControllerMode(root) !== CONTROLLER_MODES.embedded) {
    throw new Error('Only an embedded repository installation can be migrated to the external manager.');
  }
  const existingMigration = loadExternalMigration(root);
  if (existingMigration?.state === 'open' || (existingMigration?.state === 'merged' && !existingMigration.syncedAt)) {
    throw new Error(`Migration PR #${existingMigration.number} is already awaiting completion.`);
  }
  const setupPullRequest = loadSetupPullRequest(root);
  if (setupPullRequest?.state === 'open' || (setupPullRequest?.state === 'merged' && !setupPullRequest.syncedAt)) {
    throw new Error(`Resolve setup PR #${setupPullRequest.number} before starting the external-manager migration.`);
  }
  const config = loadConfig(root);
  if (!config.baseBranch) throw new Error('Select the repository base branch before migration.');
  if (currentBranch(root, runner) !== config.baseBranch) {
    throw new Error(`Switch to the configured base branch ${config.baseBranch} before migration.`);
  }
  if (gitStatus(root, runner)) throw new Error('Migration requires a clean working tree.');
  ensureGitIdentity(root, runner);

  const packageFile = path.join(root, 'package.json');
  if (!existsSync(packageFile)) throw new Error('Migration requires package.json so the embedded dependency can be removed.');
  const manifest = readJson(packageFile);
  const dependency = dependencyLocation(manifest);
  if (!dependency) throw new Error(`${AUTOMATION_PACKAGE_NAME} is not declared in package.json.`);
  const integration = loadIntegration(root);
  if (integration.paseoJson?.serviceAddedByPackage !== true) {
    throw new Error('The embedded paseo.json service is not recorded as package-managed.');
  }
  const packageManager = packageManagerRemoval(root, manifest);
  const branch = migrationBranch(root, runner, now);
  let committed = false;
  try {
    runner('git', ['switch', '-c', branch], { cwd: root });
    const service = removeManagedPaseoServiceFile(root, integration);
    runner(packageManager.command, packageManager.args, { cwd: root });
    const after = readJson(packageFile);
    if (dependencyLocation(after)) {
      throw new Error(`${packageManager.command} completed without removing ${AUTOMATION_PACKAGE_NAME} from package.json.`);
    }
    const files = changedFiles(root, runner);
    if (!files.length) throw new Error('Migration did not produce any repository changes.');
    const unexpected = files.filter((file) => !MIGRATION_FILE_SET.has(file));
    if (unexpected.length) throw new Error(`Migration produced unexpected repository changes: ${unexpected.join(', ')}.`);
    runner('git', ['add', '--', ...files], { cwd: root });
    runner('git', ['commit', '-m', 'Migrate Paseo automation to standalone manager'], { cwd: root });
    committed = true;
    const headSha = runner('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout;
    runner('git', ['push', '--set-upstream', 'origin', branch], { cwd: root });
    runner('gh', [
      'pr', 'create',
      '--base', config.baseBranch,
      '--head', branch,
      '--title', 'Migrate Paseo automation to standalone manager',
      '--body', [
        '## Summary',
        '',
        'Remove the repository-embedded Paseo Issue Automation dependency and service launcher so this repository is managed by the standalone multi-repository manager.',
        '',
        '## Changes',
        '',
        `- remove \`${AUTOMATION_PACKAGE_NAME}\` from \`package.json\` and the ${packageManager.manager} lockfile`,
        `- ${service.removedFile ? 'remove the package-created `paseo.json` file' : 'remove only the package-managed service from `paseo.json`'}`,
        '- preserve the issue template, GitHub labels, Paseo workspace, configuration, run history, and PR-review state',
        '',
        'After this PR merges and the local base branch synchronizes, the manager will finalize external mode and ordinary controller updates will no longer modify this repository.',
      ].join('\n'),
    ], { cwd: root });
    const pr = jsonRunner('gh', [
      'pr', 'view', branch,
      '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
    ], { cwd: root });
    if (!pr?.number || !pr?.url) throw new Error('GitHub created the migration PR, but its metadata could not be read.');
    const migration = saveExternalMigration(root, {
      ...normalizePr(pr),
      branch,
      baseBranch: config.baseBranch,
      headSha,
      files,
      packageManager: packageManager.manager,
      dependency,
      service,
      targetMode: CONTROLLER_MODES.external,
      createdAt: new Date().toISOString(),
      syncedAt: null,
      syncError: null,
    });
    pauseForMigration(root);
    const switched = runner('git', ['switch', config.baseBranch], { cwd: root, allowFailure: true });
    return {
      created: true,
      migration,
      returnedToBaseBranch: switched.ok,
      switchError: switched.ok ? null : switched.stderr || switched.stdout || null,
    };
  } catch (error) {
    const branchNow = currentBranch(root, runner);
    if (!committed && branchNow === branch) {
      runner('git', ['switch', config.baseBranch], { cwd: root, allowFailure: true });
      runner('git', ['branch', '-D', branch], { cwd: root, allowFailure: true });
    }
    throw error;
  }
}

export function reconcileExternalMigration(root, {
  runner = run,
  jsonRunner = runJson,
} = {}) {
  const existing = loadExternalMigration(root);
  if (!existing?.number) return { changed: false, migration: existing, reason: 'No migration PR is recorded.' };
  const pr = jsonRunner('gh', [
    'pr', 'view', String(existing.number),
    '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
  ], { cwd: root, allowFailure: true });
  if (!pr) return { changed: false, migration: existing, reason: 'Migration PR metadata is temporarily unavailable.' };
  const next = normalizePr(pr, existing);
  if (next.state === 'merged' && !next.syncedAt) {
    const status = gitStatus(root, runner);
    const branch = currentBranch(root, runner);
    if (status) {
      next.syncError = 'The migration PR merged, but local changes prevent automatic base-branch synchronization.';
    } else if (![next.baseBranch, next.branch].includes(branch)) {
      next.syncError = `Switch to ${next.baseBranch} with a clean working tree to finish migration synchronization.`;
    } else {
      if (branch === next.branch) runner('git', ['switch', next.baseBranch], { cwd: root });
      const pull = runner('git', ['pull', '--ff-only', 'origin', next.baseBranch], { cwd: root, allowFailure: true });
      if (pull.ok) {
        const manifest = readJson(path.join(root, 'package.json'));
        if (dependencyLocation(manifest)) {
          next.syncError = `${AUTOMATION_PACKAGE_NAME} is still declared after the migration PR merged.`;
        } else {
          const integration = loadIntegration(root);
          saveIntegration(root, { ...integration, paseoJson: null });
          saveControllerMode(root, CONTROLLER_MODES.external);
          next.syncedAt = new Date().toISOString();
          next.completedAt = next.syncedAt;
          next.state = 'completed';
          next.syncError = null;
        }
      } else {
        next.syncError = pull.stderr || pull.stdout || 'Could not fast-forward the local base branch.';
      }
    }
  }
  const saved = saveExternalMigration(root, next);
  return {
    changed: JSON.stringify(saved) !== JSON.stringify(existing),
    migration: saved,
    completed: saved.state === 'completed',
  };
}
