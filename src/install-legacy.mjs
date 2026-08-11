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
  saveRuntime,
  statePaths,
} from './state.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateFile = path.join(packageRoot, 'templates', 'automated-coding-task.md');

export const PASEO_SERVICE_NAME = 'issue-coding-automation';
export const PASEO_SERVICE = Object.freeze({
  type: 'service',
  command: 'npx --no-install paseo-issue-automation start',
});

export const LABEL_DETAILS = Object.freeze({
  [LABELS.ready]: ['0e8a16', 'Ready for autonomous coding'],
  [LABELS.running]: ['1d76db', 'Autonomous coding is in progress'],
  [LABELS.blocked]: ['d4c5f9', 'Automation stopped because the task is blocked'],
  [LABELS.failed]: ['b60205', 'Automation failed and needs attention'],
  [LABELS.humanReview]: ['fbca04', 'Pull request is ready for human review'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeIssueTemplate(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd() + '\n';
}

export function templateMatchesExpected(value, expectedSha256) {
  const raw = String(value || '');
  return [raw, normalizeIssueTemplate(raw)].some((candidate) => sha256(candidate) === expectedSha256);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readJsonFile(file, fallback = {}) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pauseAndRequireSetup(root) {
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  saveConfig(root, { ...loadConfig(root), setupComplete: false });
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

function githubLabels(root) {
  return runJson('gh', ['label', 'list', '--limit', '200', '--json', 'name,color,description'], {
    cwd: root,
    allowFailure: true,
  }) || [];
}

function openIssuesWithLabel(root, label) {
  const result = runJson('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,url',
  ], { cwd: root, allowFailure: true });
  if (result === null) throw new Error(`Could not inspect open issues using ${label}.`);
  return result;
}

export function activeAutomationIssues(root) {
  return openIssuesWithLabel(root, LABELS.running);
}

export function installIssueTemplate(root, { overwriteManaged = false } = {}) {
  const target = issueTemplatePath(root);
  const expected = normalizeIssueTemplate(readFileSync(templateFile, 'utf8'));
  const integration = loadIntegration(root);
  const existed = existsSync(target);

  if (existed) {
    const current = readFileSync(target, 'utf8');
    const managed = integration.issueTemplate?.createdByPackage === true;
    if (normalizeIssueTemplate(current) !== expected && !(overwriteManaged && managed)) {
      throw new Error(`${path.relative(root, target)} already exists with different content. It was not overwritten.`);
    }
  }
  if (!existed || overwriteManaged) {
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

  return { path: target, created: !existed, repaired: existed && overwriteManaged, managed: previouslyManaged || !existed };
}

export function installPaseoService(root, { overwriteManaged = false } = {}) {
  const file = paseoJsonPath(root);
  const integration = loadIntegration(root);
  const existed = existsSync(file);
  const existing = readJsonFile(file, {});
  const currentService = existing.scripts?.[PASEO_SERVICE_NAME];
  const managed = integration.paseoJson?.serviceAddedByPackage === true;

  if (currentService && !sameJson(currentService, PASEO_SERVICE) && !(overwriteManaged && managed)) {
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
    repaired: Boolean(currentService && overwriteManaged),
    managed: prior.serviceAddedByPackage === true || serviceAddedNow,
  };
}

export function installLabels(root) {
  const existing = new Map(githubLabels(root).map((label) => [label.name, label]));
  const integration = loadIntegration(root);
  const labels = { ...(integration.labels || {}) };
  const results = [];

  for (const [label, [color, description]] of Object.entries(LABEL_DETAILS)) {
    const present = existing.get(label);
    if (!present) {
      run('gh', ['label', 'create', label, '--color', color, '--description', description], { cwd: root });
      labels[label] = { createdByPackage: true };
      results.push({ label, created: true });
    } else {
      labels[label] = labels[label] || { createdByPackage: false };
      results.push({ label, created: false, reused: true });
    }
  }

  saveIntegration(root, { ...integration, labels });
  return results;
}

export function repairLabel(root, label) {
  if (!LABEL_DETAILS[label]) throw new Error(`Unknown automation label: ${label}`);
  const integration = loadIntegration(root);
  const current = githubLabels(root).find((item) => item.name === label);
  const [color, description] = LABEL_DETAILS[label];
  const owned = integration.labels?.[label]?.createdByPackage === true;
  if (current && !owned) return { label, repaired: false, reused: true };
  run('gh', ['label', 'create', label, '--color', color, '--description', description, '--force'], { cwd: root });
  saveIntegration(root, {
    ...integration,
    labels: { ...(integration.labels || {}), [label]: { createdByPackage: true } },
  });
  return { label, repaired: true };
}

export function installRepositoryIntegration(root) {
  return {
    template: installIssueTemplate(root),
    paseoJson: installPaseoService(root),
    labels: installLabels(root),
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
    if (!templateMatchesExpected(current, managed.expectedSha256)) {
      throw new Error('The installed issue template has been changed since installation. It was not deleted.');
    }
    rmSync(target);
  }

  saveIntegration(root, { ...integration, issueTemplate: null });
  pauseAndRequireSetup(root);
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
    pauseAndRequireSetup(root);
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
  pauseAndRequireSetup(root);
  return { removed: true, removedFile: removeWholeFile, path: file };
}

export function removeLabel(root, label, { force = false } = {}) {
  if (!LABEL_DETAILS[label]) throw new Error(`Unknown automation label: ${label}`);
  const integration = loadIntegration(root);
  if (integration.labels?.[label]?.createdByPackage !== true) {
    throw new Error(`${label} is not recorded as a label created by this package.`);
  }
  const usage = openIssuesWithLabel(root, label);
  if (usage.length && !force) {
    throw new Error(`${label} is used by ${usage.length} open issue(s). Confirm forced removal to continue.`);
  }
  const present = githubLabels(root).some((item) => item.name === label);
  if (present) run('gh', ['label', 'delete', label, '--yes'], { cwd: root });
  const labels = { ...(integration.labels || {}) };
  delete labels[label];
  saveIntegration(root, { ...integration, labels });
  pauseAndRequireSetup(root);
  return { removed: true, label, affectedOpenIssues: usage };
}

export function removeAllManagedLabels(root, { force = false } = {}) {
  const integration = loadIntegration(root);
  const managed = Object.keys(integration.labels || {}).filter((label) => integration.labels[label]?.createdByPackage);
  const usage = Object.fromEntries(managed.map((label) => [label, openIssuesWithLabel(root, label)]));
  const used = managed.filter((label) => usage[label].length);
  if (used.length && !force) {
    throw new Error(`Some managed labels are used by open issues: ${used.join(', ')}. Confirm forced removal to continue.`);
  }
  return managed.map((label) => removeLabel(root, label, { force: true }));
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
  const integration = loadIntegration(root);
  const existing = detectAutomationWorkspace(root);
  if (existing?.id) {
    saveIntegration(root, {
      ...integration,
      workspace: integration.workspace || { id: String(existing.id), createdByPackage: false },
    });
    return saveConfig(root, { ...loadConfig(root), workspace: existing });
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

  saveIntegration(root, {
    ...integration,
    workspace: { id: String(workspace.id), createdByPackage: true },
  });
  return saveConfig(root, { ...loadConfig(root), workspace });
}

export function removeAutomationWorkspace(root) {
  const integration = loadIntegration(root);
  const managed = integration.workspace;
  if (!managed?.createdByPackage) {
    throw new Error('The automation workspace is not recorded as a workspace created by this package.');
  }
  const active = activeAutomationIssues(root);
  if (active.length) throw new Error(`Cannot archive the automation workspace while ${active.length} issue(s) are running.`);
  const workspace = detectAutomationWorkspace(root);
  if (workspace?.id) {
    run('paseo', ['workspace', 'archive', String(workspace.id), '--json'], { cwd: root });
  }
  saveIntegration(root, { ...integration, workspace: null });
  saveConfig(root, { ...loadConfig(root), setupComplete: false, workspace: { id: null, title: WORKSPACE_TITLE } });
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  return { archived: true, workspaceId: workspace?.id || managed.id };
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
    unchanged = templateMatchesExpected(readFileSync(target, 'utf8'), managed.expectedSha256);
  }
  return {
    path: path.relative(root, target),
    present,
    createdByPackage: managed?.createdByPackage === true,
    canRemove: managed?.createdByPackage === true && (!present || unchanged),
    canRepair: managed?.createdByPackage === true && present && !unchanged,
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
    canRepair: managed?.serviceAddedByPackage === true && servicePresent && !serviceUnchanged,
    changedSinceInstall: managed?.serviceAddedByPackage === true && servicePresent && !serviceUnchanged,
  };
}

function labelManagement(root, integrationState) {
  const existing = new Map(githubLabels(root).map((label) => [label.name, label]));
  return Object.fromEntries(Object.entries(LABEL_DETAILS).map(([name, [color, description]]) => {
    const current = existing.get(name);
    const owned = integrationState.labels?.[name]?.createdByPackage === true;
    const matches = Boolean(current)
      && String(current.color || '').toLowerCase() === color.toLowerCase()
      && String(current.description || '') === description;
    return [name, {
      name,
      present: Boolean(current),
      createdByPackage: owned,
      matchesExpected: matches,
      canRemove: owned && Boolean(current),
      canRepair: !current || (owned && !matches),
    }];
  }));
}

export function npmUninstallCommand(root) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm remove -D paseo-issue-automation';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn remove paseo-issue-automation';
  return 'npm uninstall paseo-issue-automation';
}

export function installationPreview(root) {
  const integration = loadIntegration(root);
  const template = issueTemplateManagement(root, integration);
  const paseo = paseoManagement(root, integration);
  const labels = labelManagement(root, integration);
  const workspace = detectAutomationWorkspace(root);
  return {
    files: [
      {
        path: template.path,
        action: !template.present ? 'create' : template.createdByPackage ? 'verify or repair managed file' : 'reuse only if content matches',
      },
      {
        path: paseo.path,
        action: !paseo.present ? 'create' : paseo.servicePresent ? 'verify existing service' : 'add one service and preserve other content',
      },
    ],
    githubLabels: Object.values(labels).map((label) => ({
      name: label.name,
      action: label.present ? 'reuse' : 'create',
    })),
    paseoWorkspace: {
      title: WORKSPACE_TITLE,
      action: workspace?.id ? 'reuse existing workspace' : 'create local workspace',
    },
    localState: statePaths(root).root,
    npmRemovalCommand: npmUninstallCommand(root),
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
  const labels = labelManagement(root, integrationState);
  const integration = {
    issueTemplate: issueTemplate.present,
    paseoJson: paseoJson.present,
    paseoService: paseoJson.servicePresent && !paseoJson.changedSinceInstall,
    labels,
    labelsReady: Object.values(labels).every((label) => label.present),
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
    && integration.labelsReady
    && workspace?.id
    && modelsConfigured
    && baseBranchExists,
  );

  return {
    root,
    requirements: req,
    integration,
    workspace: workspace || config.workspace,
    workspaceManagement: {
      createdByPackage: integrationState.workspace?.createdByPackage === true,
      canRemove: integrationState.workspace?.createdByPackage === true && Boolean(workspace?.id),
    },
    config,
    runtime,
    checks: {
      modelsConfigured,
      baseBranchExists,
      ready,
    },
    stateDirectory: statePaths(root).root,
    npmUninstallCommand: npmUninstallCommand(root),
    preview: installationPreview(root),
  };
}

export function finishSetup(root) {
  const snapshot = setupSnapshot(root);
  if (!snapshot.checks.ready) {
    throw new Error('Setup cannot finish until every required setup check passes.');
  }
  return saveConfig(root, { ...snapshot.config, setupComplete: true, workspace: snapshot.workspace });
}

export function runSetupSelfTest(root) {
  const snapshot = setupSnapshot(root);
  const prProbe = runJson('gh', ['pr', 'list', '--state', 'all', '--limit', '1', '--json', 'number,headRefOid'], {
    cwd: root,
    allowFailure: true,
  });
  const checks = [
    ['Git repository and remote', Boolean(snapshot.requirements.git && snapshot.requirements.remote)],
    ['GitHub CLI authenticated', snapshot.requirements.githubAuthenticated],
    ['Paseo reachable', snapshot.requirements.paseoReachable],
    ['Issue template installed', snapshot.integration.issueTemplate],
    ['Paseo service installed', snapshot.integration.paseoService],
    ['Lifecycle labels present', snapshot.integration.labelsReady],
    ['Automation workspace available', Boolean(snapshot.workspace?.id)],
    ['Base branch exists', snapshot.checks.baseBranchExists],
    ['Three models configured', snapshot.checks.modelsConfigured],
    ['GitHub pull-request metadata readable', Array.isArray(prProbe)],
  ].map(([name, pass]) => ({ name, pass: Boolean(pass) }));
  return {
    pass: checks.every((check) => check.pass),
    destructive: false,
    note: 'No issue, branch, agent, pull request, or repository file was created by this self-test.',
    modelAvailability: 'Model identifiers are syntax-checked during configuration; this self-test does not launch billable agents.',
    checks,
  };
}

export function clearLocalAutomationState(root, { force = false } = {}) {
  const active = activeAutomationIssues(root);
  if (active.length) throw new Error(`Cannot clear local state while ${active.length} issue(s) are running.`);
  const integration = loadIntegration(root);
  const managedRemain = Boolean(
    integration.issueTemplate
    || integration.paseoJson
    || integration.workspace
    || Object.keys(integration.labels || {}).length,
  );
  if (managedRemain && !force) {
    throw new Error('Remove package-managed files, labels, and workspace first, or explicitly confirm losing their ownership records.');
  }
  const directory = statePaths(root).root;
  rmSync(directory, { recursive: true, force: true });
  return { cleared: true, directory };
}

export function guidedUninstall(root, options = {}) {
  const active = activeAutomationIssues(root);
  if (active.length) throw new Error(`Cannot uninstall while ${active.length} issue(s) are running.`);
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  const results = {};
  const integration = loadIntegration(root);

  if (options.issueTemplate && integration.issueTemplate?.createdByPackage) {
    results.issueTemplate = removeIssueTemplate(root);
  }
  if (options.paseoService && integration.paseoJson?.serviceAddedByPackage) {
    results.paseoService = removePaseoIntegration(root);
  }
  if (options.labels) {
    results.labels = removeAllManagedLabels(root, { force: options.forceLabels === true });
  }
  if (options.workspace && loadIntegration(root).workspace?.createdByPackage) {
    results.workspace = removeAutomationWorkspace(root);
  }
  if (options.localState) {
    results.localState = clearLocalAutomationState(root, { force: true });
  }
  results.npmRemovalCommand = npmUninstallCommand(root);
  results.npmRemovalInstruction = 'Close this dashboard, then run the command to remove the package from package.json, the lockfile, and node_modules.';
  return results;
}
