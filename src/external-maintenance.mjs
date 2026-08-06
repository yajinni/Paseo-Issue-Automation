import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_MODES, clearControllerMode, loadControllerMode, saveControllerMode } from './controller-mode.mjs';
import { loadExternalMigration } from './external-migration.mjs';
import {
  LABEL_DETAILS,
  activeAutomationIssues,
  createAutomationWorkspace,
  installIssueTemplate,
  removeAllManagedLabels,
  removeAutomationWorkspace,
  repairLabel,
} from './install-legacy.mjs';
import { run, runJson } from './process.mjs';
import {
  createSetupPullRequest,
  loadSetupPullRequest,
  preflightSetupPullRequest,
} from './setup-pr.mjs';
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

export const REMOVAL_BRANCH = 'ai/remove-paseo-repository-integration';

function maintenanceFile(root) {
  return path.join(statePaths(root).root, 'external-maintenance.json');
}

export function loadExternalMaintenance(root) {
  try {
    const file = maintenanceFile(root);
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveExternalMaintenance(root, value) {
  atomicWrite(maintenanceFile(root), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitStatus(root, runner = run) {
  const result = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    allowFailure: true,
  });
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
    throw new Error('Git user.name and user.email must be configured before creating the removal PR.');
  }
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

function removalBranch(root, runner, now) {
  if (!branchExists(root, REMOVAL_BRANCH, runner)) return REMOVAL_BRANCH;
  const suffix = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase();
  return `${REMOVAL_BRANCH}-${suffix}`;
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

function pauseRepository(root) {
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  saveConfig(root, { ...loadConfig(root), setupComplete: false });
}

function requireNoPendingRepositoryChange(root) {
  const setup = loadSetupPullRequest(root);
  if (setup?.state === 'open' || (setup?.state === 'merged' && !setup.syncedAt)) {
    throw new Error(`Resolve setup PR #${setup.number} before changing the external integration.`);
  }
  const migration = loadExternalMigration(root);
  if (migration?.state === 'open' || (migration?.state === 'merged' && !migration.syncedAt)) {
    throw new Error(`Resolve migration PR #${migration.number} before changing the external integration.`);
  }
  const maintenance = loadExternalMaintenance(root);
  const removal = maintenance?.removal;
  if (removal?.state === 'open' || (removal?.state === 'merged' && !removal.syncedAt)) {
    throw new Error(`Removal PR #${removal.number} is already awaiting completion.`);
  }
}

function requireExternalMode(root) {
  if (loadControllerMode(root) !== CONTROLLER_MODES.external) {
    throw new Error('External integration maintenance is available only for repositories managed by the standalone manager.');
  }
}

export function repairExternalRepositoryIntegration(root) {
  requireExternalMode(root);
  requireNoPendingRepositoryChange(root);
  preflightSetupPullRequest(root, { mode: CONTROLLER_MODES.external });
  const template = installIssueTemplate(root, { overwriteManaged: true });
  const labels = Object.keys(LABEL_DETAILS).map((label) => repairLabel(root, label));
  const workspace = createAutomationWorkspace(root);
  saveControllerMode(root, CONTROLLER_MODES.external);
  const setupPullRequest = createSetupPullRequest(root, { mode: CONTROLLER_MODES.external });
  if (setupPullRequest?.created) pauseRepository(root);
  const previous = loadExternalMaintenance(root) || {};
  const result = {
    repairedAt: new Date().toISOString(),
    template,
    labels,
    workspaceId: workspace?.workspace?.id || workspace?.id || null,
    setupPullRequest: setupPullRequest?.pullRequest || null,
  };
  saveExternalMaintenance(root, { ...previous, lastRepair: result });
  return result;
}

function managedTemplate(root) {
  const integration = loadIntegration(root);
  const managed = integration.issueTemplate;
  if (managed?.createdByPackage !== true) {
    throw new Error('The issue template is not recorded as a package-created file, so removal will not delete it.');
  }
  const relative = managed.path || '.github/ISSUE_TEMPLATE/automated-coding-task.md';
  const file = path.join(root, relative);
  if (!existsSync(file)) {
    throw new Error('The managed issue template is missing. Repair the external integration before creating its removal PR.');
  }
  const current = readFileSync(file, 'utf8');
  if (!managed.expectedSha256 || sha256(current) !== managed.expectedSha256) {
    throw new Error('The managed issue template changed after installation and must be reviewed manually before removal.');
  }
  return { file, relative: relative.replaceAll('\\', '/') };
}

export function createExternalRemovalPullRequest(root, {
  runner = run,
  jsonRunner = runJson,
  now = new Date(),
} = {}) {
  requireExternalMode(root);
  requireNoPendingRepositoryChange(root);
  if (activeAutomationIssues(root).length) {
    throw new Error('Stop every running automation issue before removing the repository integration.');
  }
  const config = loadConfig(root);
  if (!config.baseBranch) throw new Error('Select the repository base branch before removal.');
  if (currentBranch(root, runner) !== config.baseBranch) {
    throw new Error(`Switch to the configured base branch ${config.baseBranch} before removal.`);
  }
  if (gitStatus(root, runner)) throw new Error('Removal requires a clean working tree.');
  ensureGitIdentity(root, runner);
  const template = managedTemplate(root);
  const branch = removalBranch(root, runner, now);
  let committed = false;
  try {
    runner('git', ['switch', '-c', branch], { cwd: root });
    runner('git', ['rm', '--', template.relative], { cwd: root });
    const changed = gitStatus(root, runner);
    if (!changed) throw new Error('Removal did not produce a repository change.');
    runner('git', ['commit', '-m', 'Remove Paseo repository integration'], { cwd: root });
    committed = true;
    const headSha = runner('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout;
    runner('git', ['push', '--set-upstream', 'origin', branch], { cwd: root });
    runner('gh', [
      'pr', 'create',
      '--base', config.baseBranch,
      '--head', branch,
      '--title', 'Remove Paseo repository integration',
      '--body', [
        '## Summary',
        '',
        'Remove the repository file owned by the standalone Paseo manager.',
        '',
        '## Changes',
        '',
        `- remove the package-created \`${template.relative}\` issue template`,
        '- preserve all user-owned repository files',
        '- defer managed label and Paseo workspace cleanup until this PR merges and the local base branch synchronizes',
        '',
        'Automation remains paused while this removal is pending.',
      ].join('\n'),
    ], { cwd: root });
    const pr = jsonRunner('gh', [
      'pr', 'view', branch,
      '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
    ], { cwd: root });
    if (!pr?.number || !pr?.url) throw new Error('GitHub created the removal PR, but its metadata could not be read.');
    const previous = loadExternalMaintenance(root) || {};
    const removal = {
      ...normalizePr(pr),
      branch,
      baseBranch: config.baseBranch,
      headSha,
      files: [template.relative],
      createdAt: new Date().toISOString(),
      syncedAt: null,
      syncError: null,
    };
    saveExternalMaintenance(root, { ...previous, removal });
    pauseRepository(root);
    const switched = runner('git', ['switch', config.baseBranch], { cwd: root, allowFailure: true });
    return {
      created: true,
      removal,
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

export function reconcileExternalRemoval(root, {
  runner = run,
  jsonRunner = runJson,
} = {}) {
  const maintenance = loadExternalMaintenance(root) || {};
  const existing = maintenance.removal;
  if (!existing?.number) return { changed: false, removal: existing || null, reason: 'No removal PR is recorded.' };
  const pr = jsonRunner('gh', [
    'pr', 'view', String(existing.number),
    '--json', 'number,url,state,mergedAt,headRefName,headRefOid,baseRefName',
  ], { cwd: root, allowFailure: true });
  if (!pr) return { changed: false, removal: existing, reason: 'Removal PR metadata is temporarily unavailable.' };
  const next = normalizePr(pr, existing);
  if (next.state === 'merged' && !next.syncedAt) {
    if (gitStatus(root, runner)) {
      next.syncError = 'The removal PR merged, but local changes prevent automatic base-branch synchronization.';
    } else if (![next.baseBranch, next.branch].includes(currentBranch(root, runner))) {
      next.syncError = `Switch to ${next.baseBranch} with a clean working tree to finish removal synchronization.`;
    } else {
      if (currentBranch(root, runner) === next.branch) runner('git', ['switch', next.baseBranch], { cwd: root });
      const pull = runner('git', ['pull', '--ff-only', 'origin', next.baseBranch], {
        cwd: root,
        allowFailure: true,
      });
      if (!pull.ok) {
        next.syncError = pull.stderr || pull.stdout || 'Could not fast-forward the local base branch.';
      } else if (next.files.some((file) => existsSync(path.join(root, file)))) {
        next.syncError = 'The removal PR merged, but a managed repository file is still present locally.';
      } else {
        if (activeAutomationIssues(root).length) {
          next.syncError = 'A coding issue is still running, so managed labels and the Paseo workspace were not removed.';
        } else {
          const integration = loadIntegration(root);
          const labels = Object.keys(integration.labels || {}).length
            ? removeAllManagedLabels(root, { force: true })
            : [];
          const currentIntegration = loadIntegration(root);
          const workspace = currentIntegration.workspace?.createdByPackage === true
            ? removeAutomationWorkspace(root)
            : null;
          saveIntegration(root, {
            ...loadIntegration(root),
            issueTemplate: null,
            labels: {},
            workspace: null,
          });
          clearControllerMode(root);
          saveConfig(root, {
            ...loadConfig(root),
            setupComplete: false,
            workspace: { id: null, title: 'Paseo Issue Automation' },
          });
          saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
          next.labels = labels;
          next.workspace = workspace;
          next.syncedAt = new Date().toISOString();
          next.completedAt = next.syncedAt;
          next.state = 'completed';
          next.syncError = null;
        }
      }
    }
  }
  const saved = saveExternalMaintenance(root, { ...maintenance, removal: next });
  return {
    changed: JSON.stringify(next) !== JSON.stringify(existing),
    removal: saved.removal,
    completed: saved.removal?.state === 'completed',
  };
}

export function externalMaintenanceStatus(root) {
  const maintenance = loadExternalMaintenance(root) || {};
  const removal = maintenance.removal || null;
  const removalPending = removal?.state === 'open' || (removal?.state === 'merged' && !removal.syncedAt);
  const external = loadControllerMode(root) === CONTROLLER_MODES.external;
  return {
    lastRepair: maintenance.lastRepair || null,
    removal,
    removalPending,
    repairAvailable: external && !removalPending,
    removalAvailable: external && !removalPending,
    removalReconciliation: Boolean(removal?.number) && removal?.state !== 'completed',
  };
}
