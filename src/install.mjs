import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandAvailable, findFirstKey, run, runJson } from './process.mjs';
import {
  LABELS,
  WORKSPACE_TITLE,
  loadConfig,
  loadRuntime,
  saveConfig,
  statePaths,
} from './state.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateFile = path.join(packageRoot, 'templates', 'automated-coding-task.md');

const LABEL_DETAILS = Object.freeze({
  [LABELS.ready]: ['0e8a16', 'Ready for autonomous coding'],
  [LABELS.running]: ['1d76db', 'Autonomous coding is in progress'],
  [LABELS.blocked]: ['d4c5f9', 'Automation stopped because the task is blocked'],
  [LABELS.failed]: ['b60205', 'Automation failed and needs attention'],
  [LABELS.humanReview]: ['fbca04', 'Pull request is ready for human review'],
});

export function repositoryIdentity(root) {
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root, allowFailure: true });
  const repo = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], {
    cwd: root,
    allowFailure: true,
  });
  return {
    remote: remote.ok ? remote.stdout : null,
    nameWithOwner: repo?.nameWithOwner || null,
    defaultBranch: repo?.defaultBranchRef?.name || null,
  };
}

export function requirements(root) {
  const identity = repositoryIdentity(root);
  const ghAuth = commandAvailable('gh')
    ? run('gh', ['auth', 'status'], { cwd: root, allowFailure: true })
    : { ok: false, stderr: 'GitHub CLI is not installed.' };
  const paseoProbe = commandAvailable('paseo')
    ? run('paseo', ['workspace', 'ls', '--json'], { cwd: root, allowFailure: true })
    : { ok: false, stderr: 'Paseo CLI is not installed.' };

  return {
    git: commandAvailable('git'),
    githubCli: commandAvailable('gh'),
    githubAuthenticated: ghAuth.ok,
    githubMessage: ghAuth.ok ? 'Authenticated' : ghAuth.stderr || ghAuth.stdout,
    paseoCli: commandAvailable('paseo'),
    paseoReachable: paseoProbe.ok,
    paseoMessage: paseoProbe.ok ? 'Paseo is reachable' : paseoProbe.stderr || paseoProbe.stdout,
    remote: identity.remote,
    repository: identity.nameWithOwner,
    defaultBranch: identity.defaultBranch,
  };
}

export function paseoJsonPath(root) {
  return path.join(root, 'paseo.json');
}

export function issueTemplatePath(root) {
  return path.join(root, '.github', 'ISSUE_TEMPLATE', 'automated-coding-task.md');
}

function readJsonFile(file, fallback = {}) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function installRepositoryIntegration(root) {
  const targetTemplate = issueTemplatePath(root);
  mkdirSync(path.dirname(targetTemplate), { recursive: true });
  writeFileSync(targetTemplate, readFileSync(templateFile, 'utf8'), 'utf8');

  const file = paseoJsonPath(root);
  const existing = readJsonFile(file, {});
  const next = {
    ...existing,
    scripts: {
      ...(existing.scripts || {}),
      'issue-coding-automation': {
        type: 'service',
        command: 'npx --no-install paseo-issue-automation start',
      },
    },
  };
  writeJsonFile(file, next);

  for (const [label, [color, description]] of Object.entries(LABEL_DETAILS)) {
    run('gh', ['label', 'create', label, '--color', color, '--description', description, '--force'], {
      cwd: root,
    });
  }

  return {
    template: targetTemplate,
    paseoJson: file,
    labels: Object.keys(LABEL_DETAILS),
  };
}

function workspaceList(root) {
  return runJson('paseo', ['workspace', 'ls', '--json'], { cwd: root, allowFailure: true });
}

function findWorkspace(value) {
  if (!value || typeof value !== 'object') return null;
  const title = value.title || value.name || value.displayName;
  if (title === WORKSPACE_TITLE) {
    return {
      id: value.id || value.workspaceId || value.workspace_id || null,
      title: WORKSPACE_TITLE,
      path: value.path || value.cwd || value.directory || null,
    };
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findWorkspace(child);
      if (found) return found;
    }
  }
  return null;
}

export function detectAutomationWorkspace(root) {
  return findWorkspace(workspaceList(root));
}

export function createAutomationWorkspace(root) {
  const existing = detectAutomationWorkspace(root);
  if (existing?.id) {
    const config = loadConfig(root);
    return saveConfig(root, { ...config, workspace: existing });
  }

  const created = runJson('paseo', [
    'workspace', 'create',
    '--isolation', 'local',
    '--path', root,
    '--title', WORKSPACE_TITLE,
    '--json',
  ], { cwd: root });

  const workspace = findWorkspace(created) || {
    id: findFirstKey(created, ['workspaceId', 'workspace_id', 'id']),
    title: WORKSPACE_TITLE,
    path: root,
  };
  if (!workspace.id) throw new Error('Paseo created the workspace but did not return its ID.');

  const config = loadConfig(root);
  return saveConfig(root, { ...config, workspace });
}

function branchExists(root, branch) {
  if (!branch) return false;
  const local = run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  });
  if (local.ok) return true;
  return run('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  }).ok;
}

export function setupSnapshot(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const req = requirements(root);
  const workspace = detectAutomationWorkspace(root);
  const integration = {
    issueTemplate: existsSync(issueTemplatePath(root)),
    paseoJson: existsSync(paseoJsonPath(root)),
  };
  if (integration.paseoJson) {
    try {
      const scripts = readJsonFile(paseoJsonPath(root), {}).scripts || {};
      integration.paseoService = scripts['issue-coding-automation']?.type === 'service';
    } catch {
      integration.paseoService = false;
    }
  } else {
    integration.paseoService = false;
  }

  const modelsConfigured = Boolean(
    config.models.orchestrator && config.models.coder && config.models.reviewer,
  );
  const baseBranchExists = branchExists(root, config.baseBranch);
  const ready = Boolean(
    req.git
    && req.githubCli
    && req.githubAuthenticated
    && req.paseoCli
    && req.paseoReachable
    && req.remote
    && integration.issueTemplate
    && integration.paseoService
    && workspace?.id
    && modelsConfigured
    && baseBranchExists,
  );

  return {
    root,
    requirements: req,
    integration,
    workspace: workspace || config.workspace,
    config,
    runtime,
    checks: {
      modelsConfigured,
      baseBranchExists,
      ready,
    },
    stateDirectory: statePaths(root).root,
  };
}

export function finishSetup(root) {
  const snapshot = setupSnapshot(root);
  if (!snapshot.checks.ready) {
    throw new Error('Setup cannot finish until every required setup check passes.');
  }
  return saveConfig(root, { ...snapshot.config, setupComplete: true, workspace: snapshot.workspace });
}
