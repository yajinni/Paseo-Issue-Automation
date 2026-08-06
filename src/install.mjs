import { runJson } from './process.mjs';
import { appendControllerLog } from './controller-log.mjs';
import { CONTROLLER_MODES, loadControllerMode, saveControllerMode } from './controller-mode.mjs';
import { discoverSetupOptions } from './setup-discovery.mjs';
import { buildSetupSnapshot, clearSetupSnapshotCache } from './setup-snapshot.mjs';
import {
  clearSetupRequirementCache,
  setupRequirements,
} from './setup-requirements.mjs';
import {
  createSetupPullRequest,
  loadSetupPullRequest,
  preflightSetupPullRequest,
  reconcileSetupPullRequest,
  saveSetupPullRequest,
  setupChangeStatus,
  setupPullRequestBlocksSetup,
} from './setup-pr.mjs';
import { loadConfig, loadIntegration, saveConfig } from './state.mjs';
import * as legacy from './install-legacy.mjs';

export * from './install-legacy.mjs';

const discoveryCache = new Map();
const setupPullRequestWorkers = new Map();
const DISCOVERY_CACHE_MS = 5 * 60_000;
const SETUP_PULL_REQUEST_POLL_MS = 15_000;

function safeSetupLog(root, input) {
  try { return appendControllerLog(root, { category: 'setup', source: 'automation', ...input }); }
  catch (error) {
    console.error(JSON.stringify({ subsystem: 'controller-log', error: error.message }));
    return null;
  }
}

function setupPullRequestKey(value) {
  if (!value) return 'none';
  return [value.number, value.state, value.mergedAt, value.syncedAt, value.error].map((item) => item || '').join('|');
}

function cachedSetupOptions(root, { force = false, paseoOverride = null } = {}) {
  const cached = discoveryCache.get(root);
  if (!force && cached && Date.now() - cached.at < DISCOVERY_CACHE_MS) return cached.value;

  const discovered = discoverSetupOptions(root, {
    includeCatalog: force,
    paseoOverride,
  });

  if (!force && cached?.value?.catalog && !cached.value.catalog.skipped) {
    discovered.catalog = cached.value.catalog;
  }

  discoveryCache.set(root, { at: Date.now(), value: discovered });
  return discovered;
}

export function requirements(root, _existing = null, options = {}) {
  return setupRequirements(root, { force: options.force === true });
}

function logCreatedSetupPullRequest(root, setupPullRequest) {
  if (!setupPullRequest?.created || !setupPullRequest.pullRequest) return;
  safeSetupLog(root, {
    action: 'create-setup-pr',
    status: 'success',
    message: `Setup PR #${setupPullRequest.pullRequest.number} was committed, pushed, and opened automatically.`,
    details: {
      pullRequest: setupPullRequest.pullRequest,
      returnedToBaseBranch: setupPullRequest.returnedToBaseBranch,
      switchError: setupPullRequest.switchError,
    },
  });
}

export function installRepositoryIntegration(root) {
  preflightSetupPullRequest(root);
  const components = legacy.installRepositoryIntegration(root);
  const setupPullRequest = createSetupPullRequest(root);
  logCreatedSetupPullRequest(root, setupPullRequest);
  ensureSetupPullRequestWorker(root);
  return { controllerMode: CONTROLLER_MODES.embedded, ...components, setupPullRequest };
}

export function installExternalRepositoryIntegration(root) {
  const existingMode = loadControllerMode(root);
  if (existingMode === CONTROLLER_MODES.embedded) {
    throw new Error('This repository uses the embedded dependency installation. Use the explicit migration workflow before switching to the external manager.');
  }
  preflightSetupPullRequest(root, { mode: CONTROLLER_MODES.external });
  saveControllerMode(root, CONTROLLER_MODES.external);
  const components = {
    template: legacy.installIssueTemplate(root),
    labels: legacy.installLabels(root),
    workspace: legacy.createAutomationWorkspace(root),
  };
  const setupPullRequest = createSetupPullRequest(root, { mode: CONTROLLER_MODES.external });
  logCreatedSetupPullRequest(root, setupPullRequest);
  ensureSetupPullRequestWorker(root);
  safeSetupLog(root, {
    action: 'install-external-controller',
    status: 'success',
    message: 'Repository integration was installed for the standalone external manager without adding a package dependency or repository service launcher.',
    details: {
      controllerMode: CONTROLLER_MODES.external,
      files: setupPullRequest?.pullRequest?.files || [],
    },
  });
  return { controllerMode: CONTROLLER_MODES.external, ...components, setupPullRequest };
}

function paseoOverrideFromRequirements(req) {
  return {
    reachable: req.paseoReachable === true,
    method: req.paseoProbe?.method || 'unknown',
    message: req.paseoMessage || 'No Paseo diagnostic is available.',
    status: req.paseoProbe?.status || null,
    attempts: Array.isArray(req.paseoProbe?.attempts) ? req.paseoProbe.attempts : [],
  };
}

function synchronizeSetupCompletion(root, snapshot) {
  const setupComplete = snapshot.checks.ready === true;
  if (snapshot.config.setupComplete === setupComplete) return snapshot;
  const config = saveConfig(root, {
    ...snapshot.config,
    setupComplete,
    workspace: snapshot.workspace || snapshot.config.workspace,
  });
  safeSetupLog(root, {
    action: setupComplete ? 'setup-ready' : 'setup-not-ready',
    status: setupComplete ? 'success' : 'waiting',
    message: setupComplete
      ? 'Repository setup is complete and autonomous execution can be enabled.'
      : 'Repository setup is not complete; autonomous execution remains disabled.',
    details: {
      setupPullRequestReady: snapshot.checks.setupPullRequestReady,
      setupFilesCommitted: snapshot.checks.setupFilesCommitted,
    },
  });
  return { ...snapshot, config };
}

export function setupPullRequestAllowsRecovery(setupPullRequest) {
  if (setupPullRequest?.state === 'open') return false;
  if (setupPullRequest?.state === 'merged' && !setupPullRequest.syncedAt) return false;
  return true;
}

function existingInstallationCanBeRecovered(root, setupPullRequest, repositoryChanges) {
  if (!setupPullRequestAllowsRecovery(setupPullRequest)) return false;
  const config = loadConfig(root);
  const integration = loadIntegration(root);
  const labels = Object.values(integration.labels || {});
  const controllerMode = loadControllerMode(root);
  const controllerReady = controllerMode === CONTROLLER_MODES.external
    || integration.paseoJson?.serviceAddedByPackage === true;
  return repositoryChanges.available
    && repositoryChanges.expectedFiles.length > 0
    && repositoryChanges.unexpectedFiles.length === 0
    && repositoryChanges.currentBranch === config.baseBranch
    && integration.issueTemplate?.createdByPackage === true
    && controllerReady
    && labels.length > 0
    && Boolean(config.workspace?.id);
}

export function tickSetupPullRequest(root) {
  const previous = loadSetupPullRequest(root);
  let setupPullRequest = reconcileSetupPullRequest(root);
  if (setupPullRequestKey(previous) !== setupPullRequestKey(setupPullRequest) && setupPullRequest) {
    safeSetupLog(root, {
      level: setupPullRequest.state === 'failed' ? 'error' : 'info',
      action: 'setup-pr-state',
      status: setupPullRequest.state === 'failed' ? 'failed' : setupPullRequest.syncedAt ? 'success' : 'waiting',
      message: setupPullRequest.syncedAt
        ? `Setup PR #${setupPullRequest.number} merged and the local base branch synchronized.`
        : setupPullRequest.state === 'merged'
          ? `Setup PR #${setupPullRequest.number} merged and is waiting for local synchronization.`
          : setupPullRequest.state === 'open'
            ? `Setup PR #${setupPullRequest.number} is open and waiting to merge.`
            : `Setup PR state changed to ${setupPullRequest.state}.`,
      details: { previous, setupPullRequest },
    });
  }
  const repositoryChanges = setupChangeStatus(root);
  if (!existingInstallationCanBeRecovered(root, setupPullRequest, repositoryChanges)) {
    return { setupPullRequest, repositoryChanges, recovered: false };
  }
  try {
    const submission = createSetupPullRequest(root);
    setupPullRequest = submission.pullRequest || setupPullRequest;
    if (submission.created) {
      safeSetupLog(root, {
        action: 'recover-setup-changes',
        status: 'success',
        message: `Existing uncommitted setup files were moved into setup PR #${setupPullRequest.number}.`,
        details: {
          files: setupPullRequest.files,
          branch: setupPullRequest.branch,
          baseBranch: setupPullRequest.baseBranch,
          url: setupPullRequest.url,
        },
      });
    }
    return {
      setupPullRequest,
      repositoryChanges: setupChangeStatus(root),
      recovered: submission.created === true,
    };
  } catch (error) {
    setupPullRequest = saveSetupPullRequest(root, {
      state: 'failed',
      error: error.message,
      checkedAt: new Date().toISOString(),
    });
    safeSetupLog(root, {
      level: 'error',
      action: 'recover-setup-changes',
      status: 'failed',
      message: `Automatic setup PR recovery failed: ${error.message}`,
      details: { error, repositoryChanges },
    });
    return { setupPullRequest, repositoryChanges, recovered: false, error: error.message };
  }
}

function runSetupPullRequestTick(root) {
  try {
    tickSetupPullRequest(root);
  } catch (error) {
    saveSetupPullRequest(root, {
      state: 'failed',
      error: error.message,
      checkedAt: new Date().toISOString(),
    });
    safeSetupLog(root, {
      level: 'error',
      action: 'setup-pr-worker',
      status: 'failed',
      message: `The automatic setup PR worker failed: ${error.message}`,
      details: { error },
    });
    console.error(JSON.stringify({ subsystem: 'setup-pull-request', error: error.message }));
  }
}

export function ensureSetupPullRequestWorker(root) {
  if (setupPullRequestWorkers.has(root)) return setupPullRequestWorkers.get(root);
  const initial = setTimeout(() => runSetupPullRequestTick(root), 0);
  const timer = setInterval(() => runSetupPullRequestTick(root), SETUP_PULL_REQUEST_POLL_MS);
  initial.unref?.();
  timer.unref?.();
  const worker = { initial, timer };
  setupPullRequestWorkers.set(root, worker);
  return worker;
}

export function setupSnapshot(root, options = {}) {
  ensureSetupPullRequestWorker(root);
  const force = options.forceDiscovery === true;
  const setupPullRequest = loadSetupPullRequest(root);
  const repositoryChanges = setupChangeStatus(root);
  const req = setupRequirements(root, { force: options.forceRequirements === true });
  const setupOptions = cachedSetupOptions(root, {
    force,
    paseoOverride: paseoOverrideFromRequirements(req),
  });
  const built = buildSetupSnapshot(root, {
    requirements: req,
    branches: setupOptions.branches?.branches || [],
    forceIntegration: options.forceIntegration === true || force,
  });
  const setupPullRequestReady = !setupPullRequestBlocksSetup(setupPullRequest);
  const setupFilesCommitted = repositoryChanges.expectedFiles.length === 0;
  const snapshot = synchronizeSetupCompletion(root, {
    ...built,
    setupPullRequest,
    setupSubmissionError: setupPullRequest?.state === 'failed' ? setupPullRequest.error || 'Automatic setup PR creation failed.' : null,
    repositoryChanges,
    checks: {
      ...built.checks,
      setupPullRequestReady,
      setupFilesCommitted,
      ready: Boolean(built.checks.ready && setupPullRequestReady && setupFilesCommitted),
    },
  });
  return {
    ...snapshot,
    setupOptions,
    setupCheckedAt: new Date().toISOString(),
  };
}

// Retained for compatibility with older clients. Setup completion is now
// synchronized automatically whenever the setup snapshot is evaluated.
export function finishSetup(root) {
  const snapshot = setupSnapshot(root, {
    forceDiscovery: true,
    forceRequirements: true,
    forceIntegration: true,
  });
  if (!snapshot.checks.ready) {
    throw new Error('Setup cannot finish until every required setup check passes.');
  }
  return snapshot.config;
}

export function setupRepositoryFilesCheck(repositoryChanges = {}) {
  const changedFiles = Array.isArray(repositoryChanges.expectedFiles)
    ? repositoryChanges.expectedFiles
    : [];
  return {
    name: 'No uncommitted setup-file changes',
    pass: changedFiles.length === 0,
    details: { changedFiles },
  };
}

export function runSetupSelfTest(root) {
  const snapshot = setupSnapshot(root, {
    forceDiscovery: true,
    forceRequirements: true,
    forceIntegration: true,
  });
  const prProbe = runJson('gh', ['pr', 'list', '--state', 'all', '--limit', '1', '--json', 'number,headRefOid'], {
    cwd: root,
    allowFailure: true,
    timeoutMs: 8_000,
  });
  const controllerCheckName = snapshot.controllerMode === CONTROLLER_MODES.external
    ? 'External manager controller selected'
    : 'Paseo repository service installed';
  const checks = [
    { name: 'Git repository and remote', pass: Boolean(snapshot.requirements.git && snapshot.requirements.remote) },
    { name: 'GitHub CLI authenticated', pass: snapshot.requirements.githubAuthenticated },
    { name: 'Paseo daemon reachable', pass: snapshot.requirements.paseoReachable },
    { name: 'Issue template installed', pass: snapshot.integration.issueTemplate },
    { name: controllerCheckName, pass: snapshot.integration.controllerReady },
    { name: 'Lifecycle labels present', pass: snapshot.integration.labelsReady },
    { name: 'Automation workspace available', pass: Boolean(snapshot.workspace?.id) },
    { name: 'Base branch exists', pass: snapshot.checks.baseBranchExists },
    { name: 'Coder and Reviewer models configured', pass: snapshot.checks.modelsConfigured },
    setupRepositoryFilesCheck(snapshot.repositoryChanges),
    { name: 'Setup pull request merged and synchronized', pass: snapshot.checks.setupPullRequestReady },
    { name: 'GitHub pull-request metadata readable', pass: Array.isArray(prProbe) },
  ].map((check) => ({ ...check, pass: Boolean(check.pass) }));
  return {
    pass: checks.every((check) => check.pass),
    destructive: false,
    note: 'No issue, branch, agent, pull request, or repository file was created by this self-test.',
    modelAvailability: 'Available harnesses and models are discovered from the running Paseo daemon; this self-test does not launch billable agents.',
    paseoMessage: snapshot.requirements.paseoMessage,
    controllerMode: snapshot.controllerMode,
    uncommittedSetupFiles: snapshot.repositoryChanges.expectedFiles,
    checks,
  };
}

export function clearSetupDiscoveryCache(root) {
  if (root) discoveryCache.delete(root);
  else discoveryCache.clear();
  clearSetupRequirementCache(root);
  clearSetupSnapshotCache(root);
}
