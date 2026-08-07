import { addRepository } from '../repository-registry.mjs';
import { run as defaultRun } from '../process.mjs';
import { createPaseoConnectionContext } from './paseo-connection.mjs';
import {
  discoverRepositoryCheckouts,
  ensureRepositoryCheckout,
  managedRepositoriesRoot,
  validateCheckoutCandidate,
} from './repository-checkouts.mjs';
import { ensurePaseoWorkspaceReadiness } from './paseo-workspace-readiness.mjs';
import { loadSetupSessionStore, recordSetupPageCheck, saveSetupPage } from './store.mjs';

function activeSession(options) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function repositoryFromSession(session) {
  if (!session.repository?.owner || !session.repository?.name || !session.baseBranch) {
    throw new Error('Choose a GitHub repository and base branch before preparing a workspace.');
  }
  return {
    id: session.repository.id,
    owner: session.repository.owner,
    name: session.repository.name,
    nameWithOwner: `${session.repository.owner}/${session.repository.name}`,
    url: session.repository.url,
    host: session.pages?.repository?.selections?.host || 'github.com',
  };
}

function selection(session) {
  const value = session.pages?.checkout?.selections || {};
  return {
    checkoutPath: String(value.checkoutPath || session.managedCheckout?.path || '').trim(),
    checkoutManaged: value.checkoutManaged === true || session.managedCheckout?.managed === true,
    workspaceId: String(value.workspaceId || session.managedCheckout?.workspaceId || '').trim(),
  };
}

async function paseoContext(session, credentialStore, options = {}) {
  const host = String(session.pages?.paseo?.selections?.host || '').trim();
  if (!host) throw new Error('The verified Paseo host is missing. Recheck the Paseo page first.');
  let stored = null;
  if (credentialStore) {
    try { stored = await credentialStore.read(host); } catch { stored = null; }
  }
  const contextFactory = options.contextFactory || createPaseoConnectionContext;
  return contextFactory({ host, password: stored?.password || null, cwd: options.cwd, env: options.env, run: options.runner, runJson: options.runJson });
}

function publicCandidate(candidate) {
  return {
    path: candidate.path,
    valid: candidate.valid === true,
    safe: candidate.safe === true,
    managed: candidate.managed === true,
    dirty: candidate.dirty === true,
    writable: candidate.writable === true,
    reasons: Array.isArray(candidate.reasons) ? candidate.reasons : [],
  };
}

function publicStatus({ session, discovery, workspace = null, blocker = null, options = {} }) {
  const current = selection(session);
  return {
    repository: repositoryFromSession(session),
    baseBranch: session.baseBranch,
    selection: current,
    candidates: (discovery?.candidates || []).map(publicCandidate),
    safeChoices: (discovery?.valid || []).map(publicCandidate),
    automaticAction: discovery?.valid?.length === 0 ? 'clone-managed' : discovery?.valid?.length === 1 ? 'reuse-existing' : 'choose-existing',
    managedRoot: options.managedRoot || managedRepositoriesRoot({ rootDir: options.rootDir }),
    workspace,
    blocker,
    checkoutCheck: session.pages?.checkout?.lastCheck || null,
    workspaceCheck: session.pages?.workspace?.lastCheck || null,
    technicalDetails: {
      searchedPaths: discovery?.searchedPaths || [],
      candidateCount: discovery?.candidates?.length || 0,
      safeCandidateCount: discovery?.valid?.length || 0,
      paidModelRequestSent: workspace?.readiness?.paidModelRequestSent === true,
      cleanup: workspace?.readiness?.cleanup || null,
    },
  };
}

function discoveryFor(session, options = {}) {
  return (options.discover || discoverRepositoryCheckouts)(repositoryFromSession(session), session.baseBranch, {
    registeredRepositories: options.registeredRepositories,
    paseoWorkspaces: options.paseoWorkspaces || [],
    managedRoot: options.managedRoot || managedRepositoriesRoot({ rootDir: options.rootDir }),
    runner: options.runner || defaultRun,
    remoteProbe: options.remoteProbe,
    registryOptions: { rootDir: options.rootDir },
  });
}

export function getWorkspaceSetupPageStatus(options = {}) {
  const session = activeSession(options);
  return publicStatus({ session, discovery: discoveryFor(session, options), options });
}

function selectedExistingCheckout(session, input, options = {}) {
  const requested = String(input.checkoutPath || selection(session).checkoutPath || '').trim();
  if (!requested) return null;
  const validation = (options.validateCheckout || validateCheckoutCandidate)(requested, repositoryFromSession(session), session.baseBranch, {
    runner: options.runner || defaultRun,
    remoteProbe: options.remoteProbe,
  });
  if (!validation.valid) {
    return {
      ok: false,
      blocker: {
        code: 'checkout-selection-invalid',
        message: 'The selected local checkout no longer passes safety validation.',
        recoveryAction: 'Choose another safe checkout or let setup create a managed clone.',
      },
      validation,
    };
  }
  const register = options.register || ((checkoutPath) => addRepository(checkoutPath, { rootDir: options.rootDir, runner: options.runner || defaultRun }));
  return { ok: true, checkout: validation, registration: register(validation.path) };
}

function recordCheckoutReady(checkout, options) {
  let session = saveSetupPage('checkout', { selections: { checkoutPath: checkout.path, checkoutManaged: checkout.managed === true } }, options);
  session = recordSetupPageCheck('checkout', {
    ok: true,
    summary: 'A clean registered checkout is ready.',
    blockers: [],
  }, options);
  return session;
}

export async function prepareWorkspaceSetupPage(input = {}, options = {}) {
  let session = activeSession(options);
  const repository = repositoryFromSession(session);
  const priorDiscovery = discoveryFor(session, options);
  let checkoutResult = selectedExistingCheckout(session, input, options);

  if (!checkoutResult) {
    checkoutResult = (options.ensureCheckout || ensureRepositoryCheckout)(repository, session.baseBranch, {
      registeredRepositories: options.registeredRepositories,
      paseoWorkspaces: options.paseoWorkspaces || [],
      managedRoot: options.managedRoot || managedRepositoriesRoot({ rootDir: options.rootDir }),
      runner: options.runner || defaultRun,
      remoteProbe: options.remoteProbe,
      registryOptions: { rootDir: options.rootDir },
      register: options.register,
    });
    if (checkoutResult.status === 'choice-required') {
      session = recordSetupPageCheck('checkout', { ok: false, summary: checkoutResult.blocker.message, blockers: [checkoutResult.blocker] }, options);
      return publicStatus({ session, discovery: priorDiscovery, blocker: checkoutResult.blocker, options });
    }
    if (checkoutResult.status === 'blocked') checkoutResult = { ok: false, blocker: checkoutResult.blocker };
    else if (checkoutResult.checkout) checkoutResult = { ok: true, checkout: checkoutResult.checkout, registration: checkoutResult.registration };
  }

  if (!checkoutResult?.ok || !checkoutResult.checkout) {
    const blocker = checkoutResult?.blocker || {
      code: 'checkout-preparation-failed',
      message: 'A safe local checkout could not be prepared.',
      recoveryAction: 'Inspect checkout details and retry.',
    };
    session = recordSetupPageCheck('checkout', { ok: false, summary: blocker.message, blockers: [blocker] }, options);
    return publicStatus({ session, discovery: priorDiscovery, blocker, options });
  }

  const checkout = checkoutResult.checkout;
  session = recordCheckoutReady(checkout, options);
  const context = await paseoContext(session, options.credentialStore, options);
  const workspaceResult = (options.ensureWorkspace || ensurePaseoWorkspaceReadiness)(context, {
    checkout: checkout.path,
    repositoryRemote: checkout.remote,
    baseBranch: session.baseBranch,
    runner: options.runner || defaultRun,
    platform: options.platform,
    title: `Issue Coding Automation — ${repository.nameWithOwner}`,
  });

  if (!workspaceResult.ok) {
    const blocker = workspaceResult.blocker || {
      code: 'paseo-workspace-readiness-failed',
      message: 'Paseo workspace readiness failed.',
      recoveryAction: 'Inspect the workspace readiness details and retry.',
    };
    session = recordSetupPageCheck('workspace', { ok: false, summary: blocker.message, blockers: [blocker] }, options);
    return publicStatus({ session, discovery: priorDiscovery, workspace: workspaceResult, blocker, options });
  }

  const workspaceId = String(workspaceResult.workspace?.workspace?.id || workspaceResult.workspace?.id || '').trim();
  session = saveSetupPage('checkout', {
    selections: { checkoutPath: checkout.path, checkoutManaged: checkout.managed === true, workspaceId },
    managedCheckout: { path: checkout.path, managed: checkout.managed === true, workspaceId },
  }, options);
  session = recordSetupPageCheck('workspace', {
    ok: true,
    summary: 'Paseo workspace and isolated-worktree readiness are verified.',
    blockers: [],
  }, options);
  return publicStatus({ session, discovery: priorDiscovery, workspace: workspaceResult, options });
}

export async function recheckWorkspaceSetupPage(options = {}) {
  const session = activeSession(options);
  const current = selection(session);
  return prepareWorkspaceSetupPage(current.checkoutPath ? { checkoutPath: current.checkoutPath } : {}, options);
}
