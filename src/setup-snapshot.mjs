import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_MODES, loadControllerMode } from './controller-mode.mjs';
import { runJson } from './process.mjs';
import {
  PASEO_SERVICE,
  PASEO_SERVICE_NAME,
  issueTemplatePath,
  npmUninstallCommand,
  paseoJsonPath,
} from './install-legacy.mjs';
import { LIFECYCLE_LABEL_CATALOG } from './label-catalog.mjs';
import {
  loadConfig,
  loadIntegration,
  loadRuntime,
  statePaths,
} from './state.mjs';

const LIVE_SETUP_CACHE_MS = Number.POSITIVE_INFINITY;
const liveCache = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readJsonFile(file, fallback = {}) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function findWorkspace(value) {
  if (!value || typeof value !== 'object') return null;
  const title = value.title || value.name || value.displayName;
  if (title === 'Issue Coding Automation') {
    return {
      id: value.id || value.workspaceId || value.workspace_id || null,
      title: 'Issue Coding Automation',
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
    const parsed = readJsonFile(file, {});
    const service = parsed.scripts?.[PASEO_SERVICE_NAME];
    servicePresent = Boolean(service);
    serviceUnchanged = sameJson(service, PASEO_SERVICE);
    const remainder = { ...parsed, scripts: { ...(parsed.scripts || {}) } };
    delete remainder.scripts[PASEO_SERVICE_NAME];
    if (Object.keys(remainder.scripts).length === 0) delete remainder.scripts;
    onlyManagedContent = Object.keys(remainder).length === 0;
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

function labelManagement(existingRows, integrationState) {
  const existing = new Map(existingRows.map((label) => [label.name, label]));
  return Object.fromEntries(Object.values(LIFECYCLE_LABEL_CATALOG).map((managed) => {
    const current = existing.get(managed.name);
    const owned = integrationState.labels?.[managed.name]?.createdByPackage === true;
    const matches = Boolean(current)
      && String(current.color || '').toLowerCase() === managed.color.toLowerCase()
      && String(current.description || '') === managed.description;
    return [managed.name, {
      name: managed.name,
      present: Boolean(current),
      createdByPackage: owned,
      matchesExpected: matches,
      canRemove: owned && Boolean(current),
      canRepair: !current || (owned && !matches),
    }];
  }));
}

function liveSetupState(root, requirements, { force = false } = {}) {
  const cached = liveCache.get(root);
  if (!force && cached && Date.now() - cached.at < LIVE_SETUP_CACHE_MS) return cached.value;

  const labels = requirements.githubAuthenticated
    ? runJson('gh', ['label', 'list', '--limit', '200', '--json', 'name,color,description'], {
        cwd: root,
        allowFailure: true,
        timeoutMs: 8_000,
      }) || []
    : [];
  const workspaceData = requirements.paseoReachable
    ? runJson('paseo', ['workspace', 'ls', '--json'], {
        cwd: root,
        allowFailure: true,
        timeoutMs: 8_000,
      })
    : null;
  const value = { labels, workspace: findWorkspace(workspaceData) };
  liveCache.set(root, { at: Date.now(), value });
  return value;
}

function branchExists(branches, branch) {
  if (!branch) return false;
  return Array.isArray(branches) && branches.some((item) => item.name === branch);
}

function installationPreview({
  controllerMode,
  issueTemplate,
  paseoJson,
  labels,
  workspace,
  root,
}) {
  const files = [{
    path: issueTemplate.path,
    action: !issueTemplate.present
      ? 'create'
      : issueTemplate.createdByPackage ? 'verify or repair managed file' : 'reuse only if content matches',
  }];
  if (controllerMode !== CONTROLLER_MODES.external) {
    files.push({
      path: paseoJson.path,
      action: !paseoJson.present
        ? 'create'
        : paseoJson.servicePresent ? 'verify existing service' : 'add one service and preserve other content',
    });
  }
  return {
    controllerMode,
    files,
    githubLabels: Object.values(labels).map((label) => ({
      name: label.name,
      action: label.present ? 'reuse' : 'create',
    })),
    paseoWorkspace: {
      title: 'Issue Coding Automation',
      action: workspace?.id ? 'reuse existing workspace' : 'create local workspace',
    },
    localState: statePaths(root).root,
    packageDependency: controllerMode === CONTROLLER_MODES.external
      ? { action: 'none', reason: 'The standalone manager owns the controller executable.' }
      : { action: 'repository dependency', removalCommand: npmUninstallCommand(root) },
    npmRemovalCommand: controllerMode === CONTROLLER_MODES.external ? null : npmUninstallCommand(root),
  };
}

export function buildSetupSnapshot(root, {
  requirements,
  branches = [],
  forceIntegration = false,
  liveState = null,
  controllerMode: requestedControllerMode = null,
} = {}) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const integrationState = loadIntegration(root);
  const controllerMode = requestedControllerMode || loadControllerMode(root) || CONTROLLER_MODES.embedded;
  const live = liveState || liveSetupState(root, requirements, { force: forceIntegration });
  const issueTemplate = issueTemplateManagement(root, integrationState);
  const paseoJson = paseoManagement(root, integrationState);
  const labels = labelManagement(live.labels || [], integrationState);
  const workspace = live.workspace || config.workspace;
  const externalController = controllerMode === CONTROLLER_MODES.external;
  const embeddedControllerReady = paseoJson.servicePresent && !paseoJson.changedSinceInstall;
  const controllerReady = externalController || embeddedControllerReady;
  const integration = {
    controllerMode,
    externalController,
    controllerReady,
    issueTemplate: issueTemplate.present,
    paseoJson: paseoJson.present,
    paseoService: embeddedControllerReady,
    labels,
    labelsReady: Object.values(labels).every((label) => label.present),
    management: { issueTemplate, paseoJson },
  };
  const modelsConfigured = Boolean(config.models.coder && config.models.reviewer);
  const baseBranchExists = branchExists(branches, config.baseBranch);
  const ready = Boolean(
    requirements.git
    && requirements.githubCli
    && requirements.githubAuthenticated
    && requirements.paseoCli
    && requirements.paseoReachable
    && requirements.remote
    && integration.issueTemplate
    && integration.controllerReady
    && integration.labelsReady
    && workspace?.id
    && modelsConfigured
    && baseBranchExists,
  );
  const preview = installationPreview({
    controllerMode,
    issueTemplate,
    paseoJson,
    labels,
    workspace,
    root,
  });

  return {
    root,
    controllerMode,
    requirements,
    integration,
    workspace,
    workspaceManagement: {
      createdByPackage: integrationState.workspace?.createdByPackage === true,
      canRemove: integrationState.workspace?.createdByPackage === true && Boolean(workspace?.id),
    },
    config,
    runtime,
    checks: { modelsConfigured, baseBranchExists, controllerReady, ready },
    stateDirectory: statePaths(root).root,
    npmUninstallCommand: preview.npmRemovalCommand,
    preview,
  };
}

export function clearSetupSnapshotCache(root) {
  if (root) liveCache.delete(root);
  else liveCache.clear();
}
