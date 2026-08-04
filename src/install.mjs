import { resolveCommand, runJson } from './process.mjs';
import { discoverSetupOptions, probePaseo } from './setup-discovery.mjs';
import { loadConfig, saveConfig } from './state.mjs';
import * as legacy from './install-legacy.mjs';

export * from './install-legacy.mjs';

const discoveryCache = new Map();
const DISCOVERY_CACHE_MS = 60_000;

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

export function requirements(root) {
  const existing = legacy.requirements(root);
  const paseoResolution = resolveCommand('paseo');
  const paseoCli = paseoResolution.available;
  const paseo = paseoCli
    ? probePaseo(root)
    : {
        reachable: false,
        method: 'missing-cli',
        message: 'Paseo CLI was not found on PATH or in the standard Paseo Desktop installation folders.',
        status: null,
        attempts: [],
      };
  return {
    ...existing,
    paseoCli,
    paseoCommandPath: paseoResolution.path,
    paseoCommandSource: paseoResolution.source,
    paseoReachable: paseo.reachable,
    paseoMessage: paseo.message,
    paseoProbe: {
      method: paseo.method,
      status: paseo.status,
      attempts: paseo.attempts,
    },
  };
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

export function setupSnapshot(root, options = {}) {
  const snapshot = legacy.setupSnapshot(root);
  const req = requirements(root);
  const ready = Boolean(
    req.git
    && req.githubCli
    && req.githubAuthenticated
    && req.paseoCli
    && req.paseoReachable
    && req.remote
    && snapshot.integration.issueTemplate
    && snapshot.integration.paseoService
    && snapshot.integration.labelsReady
    && snapshot.workspace?.id
    && snapshot.checks.modelsConfigured
    && snapshot.checks.baseBranchExists,
  );
  return {
    ...snapshot,
    requirements: req,
    checks: { ...snapshot.checks, ready },
    setupOptions: cachedSetupOptions(root, {
      force: options.forceDiscovery === true,
      paseoOverride: paseoOverrideFromRequirements(req),
    }),
    setupCheckedAt: new Date().toISOString(),
  };
}

export function finishSetup(root) {
  const snapshot = setupSnapshot(root, { forceDiscovery: true });
  if (!snapshot.checks.ready) {
    throw new Error('Setup cannot finish until every required setup check passes.');
  }
  return saveConfig(root, { ...snapshot.config, setupComplete: true, workspace: snapshot.workspace });
}

export function runSetupSelfTest(root) {
  const snapshot = setupSnapshot(root, { forceDiscovery: true });
  const prProbe = runJson('gh', ['pr', 'list', '--state', 'all', '--limit', '1', '--json', 'number,headRefOid'], {
    cwd: root,
    allowFailure: true,
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
}
