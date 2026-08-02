import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandAvailable, findFirstKey, run, runJson } from './process.mjs';
import {
  LABELS,
  WORKSPACE_TITLE,
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  statePaths,
} from './state.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateFile = path.join(packageRoot, 'templates', 'automated-coding-task.md');

export const PASEO_SERVICE_NAME = 'issue-coding-automation';
export const PASEO_SERVICE = Object.freeze({
  type: 'service',
  command: 'npx --no-install paseo-issue-automation start',
});

const LABEL_DETAILS = Object.freeze({
  [LABELS.ready]: ['0e8a16', 'Ready for autonomous coding'],
  [LABELS.running]: ['1d76db', 'Autonomous coding is in progress'],
  [LABELS.blocked]: ['d4c5f9', 'Automation stopped because the task is blocked'],
  [LABELS.failed]: ['b60205', 'Automation failed and needs attention'],
  [LABELS.humanReview]: ['fbca04', 'Pull request is ready for human review'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

export function installIssueTemplate(root) {
  const target = issueTemplatePath(root);
  const expected = readFileSync(templateFile, 'utf8');
  const integration = loadIntegration(root);
  const existed = existsSync(target);

  if (existed) {
    const current = readFileSync(target, 'utf8');
    if (current !== expected) {
      throw new Error(`${path.relative(root, target)} already exists with different content. It was not overwritten.`);
    }
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, expected, 'utf8');
  }

  const previouslyManaged = integration.issueTemplate?.createdByPackage === true;
  saveIntegration(root, {
    ...integration,
    issueTemplate: {
      path: path.relative(root, target),
      createdByPackage: previouslyManaged || !existed,
      expectedSha256: sha256(expected),
    },
  });

  return { path: target, created: !existed, managed: previouslyManaged || !existed };
}

export function installPaseoService(root) {
  const file = paseoJsonPath(root);
  const integration = loadIntegration(root);
  const existed = existsSync(file);
  const existing = readJsonFile(file, {});
  const currentService = existing.scripts?.[PASEO_SERVICE_NAME];

  if (currentService && !sameJson(currentService, PASEO_SERVICE)) {
    throw new Error(`paseo.json already contains a conflicting ${PASEO_SERVICE_NAME} service. It was not changed.`);
  }

  const serviceAddedNow = !currentService;
  const next = {
    ...existing,
    scripts: {
      ...(existing.scripts || {}),
      [PASEO_SERVICE_NAME]: PASEO_SERVICE,
    },
  };
  writeJsonFile(file, next);

  const prior = integration.paseoJson || {};
  saveIntegration(root, {
    ...integration,
    paseoJson: {
      path: path.relative(root, file),
      createdByPackage: prior.createdByPackage === true || !existed,
      serviceAddedByPackage: prior.serviceAddedByPackage === true || serviceAddedNow,
      serviceName: PASEO_SERVICE_NAME,
    },
  });

  return {
    path: file,
    created: !existed,
    modified: existed && serviceAddedNow,
    managed: prior.serviceAddedByPackage === true || serviceAddedNow,
  };
}

export function installRepositoryIntegration(root) {
  const issueTemplate = installIssueTemplate(root);
  const paseoJson = installPaseoService(root);

  for (const [label, [color, description]] of Object.entries(LABEL_DETAILS)) {
    run('gh', ['label', 'create', label, '--color', color, '--description', description, '--force'], {
      cwd: root,
    });
  }

  return {
    template: issueTemplate,
    paseoJson,
    labels: Object.keys(LABEL_DETAILS),
  };
}

export function removeIssueTemplate(root) {
  const integration = loadIntegration(root);
  const managed = integration.issueTemplate;
  const target = issueTemplatePath(root);
  if (!managed?.createdByPackage) {
    throw new Error('The issue template is not recorded as a file created by this package, so it will not be deleted.');
  }

  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8');
    if (sha256(current) !== managed.expectedSha256) {
      throw new Error('The installed issue template has been changed since installation. It was not deleted.');
    }
    rmSync(target);
  }

  saveIntegration(root, { ...integration, issueTemplate: null });
  return { removed: true, path: target };
}

export function removePaseoIntegration(root) {
  const integration = loadIntegration(root);
  const managed = integration.paseoJson;
  const file = paseoJsonPath(root);
  if (!managed?.serviceAddedByPackage) {
    throw new Error('The Paseo service is not recorded as an addition made by this package, so it will not be removed.');
  }

  if (!existsSync(file)) {
    saveIntegration(root, { ...integration, paseoJson: null });
    return { removed: true, removedFile: false, path: file };
  }

  const existing = readJsonFile(file, {});
  const currentService = existing.scripts?.[PASEO_SERVICE_NAME];
  if (currentService && !sameJson(currentService, PASEO_SERVICE)) {
    throw new Error(`The ${PASEO_SERVICE_NAME} entry has been changed since installation. It was not removed.`);
  }

  const next = { ...existing, scripts: { ...(existing.scripts || {}) } };
  delete next.scripts[PASEO_SERVICE_NAME];
  if (Object.keys(next.scripts).length === 0) delete next.scripts;

  const removeWholeFile = managed.createdByPackage === true && Object.keys(next).length === 0;
  if (removeWholeFile) rmSync(file);
  else writeJsonFile(file, next);

  saveIntegration(root, { ...integration, paseoJson: null });
  return { removed: true, removedFile: removeWholeFile, path: file };
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

function issueTemplateManagement(root, integrationState) {
  const target = issueTemplatePath(root);
  const present = existsSync(target);
  const managed = integrationState.issueTemplate;
  let unchanged = false;
  if (present && managed?.expectedSha256) {
    unchanged = sha256(readFileSync(target, 'utf8')) === managed.expectedSha256;
  }
  return {
    path: path.relative(root, target),
    present,
    createdByPackage: managed?.createdByPackage === true,
    canRemove: managed?.createdByPackage === true && (!present || unchanged),
    changedSinceInstall: managed?.createdByPackage === true && present && !unchanged,
  };
}

function paseoManagement(root, integrationState) {
  const file = paseoJsonPath(root);
  const present = existsSync(file);
  const managed = integrationState.paseoJson;
  let servicePresent = false;
  let serviceUnchanged = false;
  let onlyManagedContent = false;
  if (present) {
    try {
      const parsed = readJsonFile(file, {});
      const service = parsed.scripts?.[PASEO_SERVICE_NAME];
      servicePresent = Boolean(service);
      serviceUnchanged = sameJson(service, PASEO_SERVICE);
      const remainder = { ...parsed, scripts: { ...(parsed.scripts || {}) } };
      delete remainder.scripts[PASEO_SERVICE_NAME];
      if (Object.keys(remainder.scripts).length === 0) delete remainder.scripts;
      onlyManagedContent = Object.keys(remainder).length === 0;
    } catch {
      servicePresent = false;
    }
  }
  const canRemove = managed?.serviceAddedByPackage === true && (!servicePresent || serviceUnchanged);
  return {
    path: path.relative(root, file),
    present,
    servicePresent,
    createdByPackage: managed?.createdByPackage === true,
    serviceAddedByPackage: managed?.serviceAddedByPackage === true,
    removalMode: canRemove && managed?.createdByPackage === true && onlyManagedContent
      ? 'file'
      : managed?.serviceAddedByPackage === true ? 'managed-section' : null,
    canRemove,
    changedSinceInstall: managed?.serviceAddedByPackage === true && servicePresent && !serviceUnchanged,
  };
}

export function setupSnapshot(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const req = requirements(root);
  const workspace = detectAutomationWorkspace(root);
  const integrationState = loadIntegration(root);
  const issueTemplate = issueTemplateManagement(root, integrationState);
  const paseoJson = paseoManagement(root, integrationState);
  const integration = {
    issueTemplate: issueTemplate.present,
    paseoJson: paseoJson.present,
    paseoService: paseoJson.servicePresent && !paseoJson.changedSinceInstall,
    management: { issueTemplate, paseoJson },
  };

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
