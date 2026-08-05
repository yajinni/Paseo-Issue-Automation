import { runJson } from './process.mjs';
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
const DISCOVERY_CACHE_MS = 5 * 60_000;

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

export function installRepositoryIntegration(root) {
  preflightSetupPullRequest(root);
  const components = legacy.installRepositoryIntegration(root);
  const setupPullRequest = createSetupPullRequest(root);
  return { ...components, setupPullRequest };
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
  return { ...snapshot, config };
}

function existingInstallationCanBeRecovered(root, setupPullRequest, repositoryChanges) {
  if (setupPullRequest?.state === 'open' || setupPullRequest?.state === 'merged') return false;
  const config = loadConfig(root);
  const integration = loadIntegration(root);
  const labels = Object.values(integration.labels || {});
  return repositoryChanges.available
    && repositoryChanges.expectedFiles.length > 0
    && repositoryChanges.unexpectedFiles.length === 0
    && repositoryChanges.currentBranch === config.baseBranch
    && integration.issueTemplate?.createdByPackage === true
    && integration.paseoJson?.serviceAddedByPackage === true
    && labels.length > 0
    && Boolean(config.workspace?.id);
}

export function tickSetupPullRequest(root) {
  let setupPullRequest = reconcileSetupPullRequest(root);
  const repositoryChanges = setupChangeStatus(root);
  if (!existingInstallationCanBeRecovered(root, setupPullRequest, repositoryChanges)) {
    return { setupPullRequest, repositoryChanges, recovered: false };
  }
  try {
    const submission = createSetupPullRequest(root);
    setupPullRequest = submission.pullRequest || setupPullRequest;
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
    return { setupPullRequest, repositoryChanges, recovered: false, error: error.message };
  }
}

export function setupSnapshot(root, options = {}) {
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
  const checks = [
    ['Git repository and remote', Boolean(snapshot.requirements.git && snapshot.requirements.remote)],
    ['GitHub CLI authenticated', snapshot.requirements.githubAuthenticated],
    ['Paseo daemon reachable', snapshot.requirements.paseoReachable],
    ['Issue template installed', snapshot.integration.issueTemplate],
    ['Paseo service installed', snapshot.integration.paseoService],
    ['Lifecycle labels present', snapshot.integration.labelsReady],
    ['Automation workspace available', Boolean(snapshot.workspace?.id)],
    ['Base branch exists', snapshot.checks.baseBranchExists],
    ['Coder and Reviewer models configured', snapshot.checks.modelsConfigured],
    ['Setup repository files committed', snapshot.checks.setupFilesCommitted],
    ['Setup pull request merged and synchronized', snapshot.checks.setupPullRequestReady],
    ['GitHub pull-request metadata readable', Array.isArray(prProbe)],
  ].map(([name, pass]) => ({ name, pass: Boolean(pass) }));
  return {
    pass: checks.every((check) => check.pass),
    destructive: false,
    note: 'No issue, branch, agent, pull request, or repository file was created by this self-test.',
    modelAvailability: 'Available harnesses and models are discovered from the running Paseo daemon; this self-test does not launch billable agents.',
    paseoMessage: snapshot.requirements.paseoMessage,
    checks,
  };
}

export function clearSetupDiscoveryCache(root) {
  if (root) discoveryCache.delete(root);
  else discoveryCache.clear();
  clearSetupRequirementCache(root);
  clearSetupSnapshotCache(root);
}
