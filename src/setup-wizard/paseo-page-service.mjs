import { resolveCommand } from '../process.mjs';
import {
  createPaseoConnectionContext,
  paseoHostCandidates,
  probePaseoConnection,
  redactSensitive,
} from './paseo-connection.mjs';
import {
  credentialStatusForApi,
} from './paseo-credentials.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

export const PASEO_INSTALL_INSTRUCTIONS = 'npm install -g @getpaseo/cli\npaseo';
export const PASEO_START_INSTRUCTIONS = 'paseo daemon start';

function safeHost(value) {
  const host = String(value || '').trim();
  if (!host) return null;
  if (/\s|[?&]password=/i.test(host)) throw new Error('Paseo host is invalid.');
  return host;
}

function webUrlForHost(host) {
  const value = safeHost(host);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:unix:|\\\\\.\\pipe\\)/i.test(value)) return null;
  return `http://${value.replace(/^tcp:\/\//i, '')}/`;
}

function cliInstallationStatus({ resolver = resolveCommand, env = process.env, platform = process.platform } = {}) {
  const resolution = resolver('paseo', { env, platform });
  return {
    installed: resolution.available === true,
    path: resolution.path || null,
    source: resolution.source || (resolution.available ? 'path' : 'missing'),
    installInstructions: PASEO_INSTALL_INSTRUCTIONS,
    docsUrl: 'https://paseo.sh/docs',
  };
}

function pageSelections(options) {
  const store = loadSetupSessionStore(options);
  return store.activeSession?.pages?.paseo?.selections || {};
}

function blockersForProbe(probe, cliStatus) {
  const blockers = [];
  if (!cliStatus.installed || probe?.cli?.ok !== true) {
    blockers.push({
      code: 'paseo-cli-required',
      message: 'Paseo CLI is not available in the manager process environment.',
      recoveryAction: 'Install the Paseo CLI, then use Check again.',
    });
  }
  if (!probe?.daemon?.reachable) {
    if (probe?.authentication?.required) {
      blockers.push({
        code: 'paseo-password-required',
        message: probe.authentication.supplied
          ? 'Paseo rejected the supplied password.'
          : 'This Paseo daemon requires a password.',
        recoveryAction: 'Enter the daemon password and check again.',
      });
    } else {
      blockers.push({
        code: 'paseo-daemon-unreachable',
        message: 'The Paseo daemon could not be reached at the selected host.',
        recoveryAction: 'Open or start Paseo, then check again.',
      });
    }
  }
  if (probe?.daemon?.reachable && probe?.compatibility?.ok !== true) {
    blockers.push({
      code: 'paseo-version-incompatible',
      message: probe?.compatibility?.reason || 'The Paseo CLI and daemon are not compatible.',
      recoveryAction: 'Update Paseo and the CLI, then check again.',
    });
  }
  return blockers;
}

function checkResult(probe, cliStatus) {
  const blockers = blockersForProbe(probe, cliStatus);
  return {
    ok: blockers.length === 0,
    summary: blockers.length === 0
      ? 'Paseo daemon, authentication, compatibility, and CLI checks passed.'
      : blockers[0].message,
    blockers,
  };
}

async function credentialForHost(credentialStore, host) {
  if (!credentialStore || !host) return null;
  try { return await credentialStore.read(host); }
  catch { return null; }
}

function probeHost(host, password, options = {}) {
  const contextFactory = options.contextFactory || createPaseoConnectionContext;
  const probe = options.probe || probePaseoConnection;
  const context = contextFactory({
    host,
    password: password || null,
    cwd: options.cwd,
    env: options.env,
    run: options.run,
    runJson: options.runJson,
  });
  return probe(context, options);
}

async function automaticProbe({
  savedHost,
  credentialStore,
  containerized = false,
  options = {},
} = {}) {
  const attempts = [];
  for (const host of paseoHostCandidates({ savedHost, containerized })) {
    const credential = await credentialForHost(credentialStore, host);
    const probe = probeHost(host, credential?.password || null, options);
    attempts.push(probe);
    if (probe.ok) return { probe, attempts, manualAllowed: false, needsAuthentication: false };
    if (probe.authentication?.required) {
      return { probe, attempts, manualAllowed: false, needsAuthentication: true };
    }
  }
  return { probe: attempts.at(-1) || null, attempts, manualAllowed: true, needsAuthentication: false };
}

async function persistentCredentialStatus(credentialStore) {
  if (!credentialStore) return credentialStatusForApi(null);
  try { return credentialStatusForApi(await credentialStore.status()); }
  catch (error) {
    return credentialStatusForApi({
      persistentAvailable: false,
      sessionAvailable: true,
      reason: `Secure credential storage could not be verified: ${error.message}`,
    });
  }
}

function publicProbe(probe) {
  if (!probe) return null;
  return redactSensitive({
    ok: probe.ok === true,
    host: probe.host || null,
    authentication: probe.authentication || null,
    cli: probe.cli || null,
    daemon: probe.daemon || null,
    compatibility: probe.compatibility || null,
    diagnostic: probe.diagnostic || null,
  });
}

function responseShape({ probe, attempts = [], manualAllowed, credentialStatus, cliStatus, session, storedCredential = null }) {
  const page = session?.pages?.paseo || {};
  const check = page.lastCheck || checkResult(probe, cliStatus);
  return {
    host: probe?.host || page.selections?.host || null,
    openUrl: webUrlForHost(probe?.host || page.selections?.host || null),
    manualAllowed: manualAllowed === true,
    passwordRequired: probe?.authentication?.required === true,
    credential: {
      ...credentialStatus,
      savedForHost: storedCredential?.persistent === true,
      availableForSession: Boolean(storedCredential),
    },
    cli: { ...cliStatus, ...(probe?.cli || {}) },
    daemon: probe?.daemon || { reachable: false, version: null },
    authentication: probe?.authentication || { required: false, supplied: false, ok: false },
    compatibility: probe?.compatibility || { ok: false, reason: 'Paseo has not been verified yet.' },
    check,
    instructions: {
      installCli: PASEO_INSTALL_INSTRUCTIONS,
      startDaemon: PASEO_START_INSTRUCTIONS,
    },
    technicalDetails: redactSensitive({
      host: probe?.host || null,
      probe: publicProbe(probe),
      attemptedHosts: attempts.map((attempt) => attempt?.host).filter(Boolean),
      credentialBackend: credentialStatus,
    }),
  };
}

export async function getPaseoSetupPageStatus({ credentialStore, ...options } = {}) {
  const selections = pageSelections(options);
  const savedHost = safeHost(selections.host);
  const cliStatus = cliInstallationStatus(options);
  const credentialStatus = await persistentCredentialStatus(credentialStore);
  const automatic = await automaticProbe({
    savedHost,
    credentialStore,
    containerized: options.containerized === true,
    options,
  });
  const host = automatic.probe?.host || savedHost;
  const storedCredential = await credentialForHost(credentialStore, host);
  const store = loadSetupSessionStore(options);
  return responseShape({
    ...automatic,
    credentialStatus,
    cliStatus,
    session: store.activeSession,
    storedCredential,
  });
}

export async function connectPaseoSetupPage({ host, password = '', remember = true, credentialStore, ...options } = {}) {
  const selectedHost = safeHost(host);
  if (!selectedHost) throw new Error('A Paseo host is required.');

  // Persist only the non-secret host before probing so an incorrect password never discards daemon discovery.
  let session = saveSetupPage('paseo', { selections: { host: selectedHost } }, options);
  const cliStatus = cliInstallationStatus(options);
  const credentialStatus = await persistentCredentialStatus(credentialStore);
  const probe = probeHost(selectedHost, password || null, options);
  const check = checkResult(probe, cliStatus);

  let storedCredential = await credentialForHost(credentialStore, selectedHost);
  if (check.ok && password && credentialStore) {
    await credentialStore.write(selectedHost, password, { remember: remember === true });
    storedCredential = await credentialForHost(credentialStore, selectedHost);
  }

  session = recordSetupPageCheck('paseo', check, options);
  return responseShape({
    probe,
    attempts: [probe],
    manualAllowed: !probe.ok && !probe.authentication?.required,
    credentialStatus,
    cliStatus,
    session,
    storedCredential,
  });
}

export async function recheckPaseoSetupPage({ credentialStore, ...options } = {}) {
  const selections = pageSelections(options);
  const savedHost = safeHost(selections.host);
  const cliStatus = cliInstallationStatus(options);
  const credentialStatus = await persistentCredentialStatus(credentialStore);

  let probe;
  let attempts = [];
  let manualAllowed = false;
  let storedCredential = null;
  if (savedHost) {
    storedCredential = await credentialForHost(credentialStore, savedHost);
    probe = probeHost(savedHost, storedCredential?.password || null, options);
    attempts = [probe];
    manualAllowed = !probe.ok && !probe.authentication?.required;
  } else {
    const automatic = await automaticProbe({
      savedHost: null,
      credentialStore,
      containerized: options.containerized === true,
      options,
    });
    probe = automatic.probe;
    attempts = automatic.attempts;
    manualAllowed = automatic.manualAllowed;
    if (probe?.host) {
      saveSetupPage('paseo', { selections: { host: probe.host } }, options);
      storedCredential = await credentialForHost(credentialStore, probe.host);
    }
  }
  const check = checkResult(probe, cliStatus);
  const session = recordSetupPageCheck('paseo', check, options);
  return responseShape({ probe, attempts, manualAllowed, credentialStatus, cliStatus, session, storedCredential });
}

export async function forgetPaseoSetupCredential({ credentialStore, ...options } = {}) {
  const host = safeHost(pageSelections(options).host);
  if (host && credentialStore) await credentialStore.forget(host);
  const session = recordSetupPageCheck('paseo', {
    ok: false,
    summary: 'Saved Paseo authentication was removed. Recheck the connection.',
    blockers: [{
      code: 'paseo-authentication-recheck-required',
      message: 'Paseo authentication must be checked again.',
      recoveryAction: 'Use Check again and enter the password if required.',
    }],
  }, options);
  return { host, forgotten: true, session };
}
