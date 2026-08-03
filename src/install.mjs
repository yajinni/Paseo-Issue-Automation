import { commandAvailable, runJson } from './process.mjs';
import { discoverSetupOptions, probePaseo } from './setup-discovery.mjs';
import { loadConfig, saveConfig } from './state.mjs';
import * as legacy from './install-legacy.mjs';

export * from './install-legacy.mjs';

const discoveryCache = new Map();
const DISCOVERY_CACHE_MS = 60_000;

function cachedSetupOptions(root) {
  const cached = discoveryCache.get(root);
  if (cached && Date.now() - cached.at < DISCOVERY_CACHE_MS) return cached.value;
  const value = discoverSetupOptions(root);
  discoveryCache.set(root, { at: Date.now(), value });
  return value;
}

export function requirements(root) {
  const existing = legacy.requirements(root);
  const paseoCli = commandAvailable('paseo');
  const paseo = paseoCli
    ? probePaseo(root)
    : {
        reachable: false,
        method: 'missing-cli',
        message: 'Paseo CLI is not installed or is not available on PATH.',
        status: null,
        attempts: [],
      };
  return {
    ...existing,
    paseoCli,
    paseoReachable: paseo.reachable,
    paseoMessage: paseo.message,
    paseoProbe: {
      method: paseo.method,
      status: paseo.status,
      attempts: paseo.attempts,
    },
  };
}

export function setupSnapshot(root) {
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
    setupOptions: cachedSetupOptions(root),
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
