import { run as defaultRun } from './process.mjs';
import { loadManagerPaseoConnection, saveManagerPaseoConnection } from './manager-paseo-connections.mjs';
import { discoverPaseoCatalog } from './setup-discovery.mjs';
import {
  createPaseoConnectionContext,
  paseoHostCandidates,
  probePaseoConnection,
  redactSensitive,
} from './setup-wizard/paseo-connection.mjs';
import { loadSetupSessionStore } from './setup-wizard/store.mjs';

function repositoryName(session = {}) {
  const selected = String(session.pages?.repository?.selections?.repository || '').trim();
  if (selected) return selected;
  const owner = String(session.repository?.owner || '').trim();
  const name = String(session.repository?.name || '').trim();
  return owner && name ? `${owner}/${name}` : null;
}

function legacySetupHost(repository, options = {}) {
  if (!options.rootDir) return null;
  try {
    const store = loadSetupSessionStore(options);
    const sessions = [store.activeSession, ...(store.completedSessions || []).slice().reverse()].filter(Boolean);
    const match = sessions.find((session) => repositoryName(session) === repository.repository);
    return String(match?.pages?.paseo?.selections?.host || '').trim() || null;
  } catch {
    return null;
  }
}

function hostsFor(repository, options = {}) {
  const durable = loadManagerPaseoConnection(repository, options)?.host || null;
  const legacy = legacySetupHost(repository, options);
  return [...new Set([
    durable,
    legacy,
    ...paseoHostCandidates({ savedHost: durable || legacy, containerized: options.containerized === true }),
  ].filter(Boolean))];
}

async function credentialForHost(store, host) {
  if (!store || !host) return null;
  try { return await store.read(host); }
  catch { return null; }
}

async function connectionForHost(context, host, options = {}, passwordOverride = undefined) {
  const stored = passwordOverride === undefined
    ? await credentialForHost(options.credentialStore, host)
    : null;
  const factory = options.paseoContextFactory || createPaseoConnectionContext;
  return factory({
    host,
    password: passwordOverride === undefined ? stored?.password || null : passwordOverride || null,
    cwd: context.root,
    env: options.env,
    run: options.run,
    runJson: options.runJson,
  });
}

function publicCatalog(catalog) {
  const safe = redactSensitive(catalog || {});
  return {
    providers: (safe.providers || []).map((provider) => ({
      id: String(provider.id),
      label: String(provider.label || provider.id),
      status: String(provider.status || 'available'),
      defaultMode: provider.defaultMode || null,
      modes: Array.isArray(provider.modes) ? provider.modes : [],
      models: (provider.models || []).map((model) => ({
        id: String(model.id),
        label: String(model.label || model.id),
        description: String(model.description || ''),
        value: String(model.value || `${provider.id}/${model.id}`),
        thinkingOptionIds: Array.isArray(model.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [],
        defaultThinkingOptionId: model.defaultThinkingOptionId == null ? null : String(model.defaultThinkingOptionId),
      })),
      noModels: !(provider.models || []).length && !provider.error?.includes('Could not list models'),
      warning: provider.error || null,
    })),
    errors: Array.isArray(safe.errors) ? safe.errors.map(String) : [],
    complete: safe.complete === true,
    elapsedMs: Number(safe.elapsedMs || 0),
  };
}

function commandDiagnostic(args, result = {}) {
  return redactSensitive({
    command: `paseo ${args.map(String).join(' ')}`,
    ok: result?.ok === true,
    exitCode: result?.exitCode ?? null,
    timedOut: result?.timedOut === true,
    resolvedCommand: result?.resolvedCommand || null,
    resolutionSource: result?.resolutionSource || null,
    message: String(result?.stderr || (!result?.ok ? result?.stdout || '' : '')).trim().slice(0, 1200) || null,
  });
}

export async function managerHarnessCatalog(context, options = {}) {
  const attempts = [];
  const loader = options.catalogLoader || ((root, discoveryOptions) => discoverPaseoCatalog(root, discoveryOptions));
  for (const host of hostsFor(context.repository, options)) {
    const paseo = await connectionForHost(context, host, options);
    const commands = [];
    const runner = (command, args, runnerOptions = {}) => {
      if (command === 'paseo') {
        const result = paseo.command(args, runnerOptions);
        commands.push(commandDiagnostic(args, result));
        return result;
      }
      return (options.run || defaultRun)(command, args, runnerOptions);
    };
    try {
      const catalog = publicCatalog(await loader(context.root, {
        runner,
        commandTimeoutMs: options.commandTimeoutMs,
        totalTimeoutMs: options.totalTimeoutMs,
      }));
      const diagnostic = { host, providerCount: catalog.providers.length, catalogErrors: catalog.errors, commands };
      attempts.push(diagnostic);
      if (catalog.providers.length) {
        saveManagerPaseoConnection(context.repository, host, options);
        return { host, catalog, diagnostics: diagnostic };
      }
    } catch (error) {
      attempts.push({ host, providerCount: 0, catalogErrors: [String(error?.message || error)], commands });
    }
  }
  const detail = attempts.map((attempt) => {
    const provider = attempt.commands.find((item) => item.command === 'paseo provider ls --json');
    const command = provider?.resolvedCommand ? ` CLI ${provider.resolvedCommand}.` : '';
    const failure = provider && !provider.ok ? ` provider ls failed${provider.exitCode == null ? '' : ` (exit ${provider.exitCode})`}: ${provider.message || 'no diagnostic'}.` : '';
    const errors = attempt.catalogErrors?.length ? ` ${attempt.catalogErrors.join(' | ')}` : '';
    return `${attempt.host}:${command}${failure}${errors}`.trim();
  }).join(' ; ');
  throw new Error(`Paseo did not return an available coding harness. Tried ${attempts.length || 0} connection candidate${attempts.length === 1 ? '' : 's'}.${detail ? ` ${detail}` : ''}`);
}

function publicProbe(probe, source) {
  return redactSensitive({
    source,
    ok: probe?.ok === true,
    host: probe?.host || null,
    cli: probe?.cli || null,
    daemon: probe?.daemon || null,
    authentication: probe?.authentication || null,
    compatibility: probe?.compatibility || null,
    diagnostic: probe?.diagnostic || null,
  });
}

export async function managerPaseoConnectionStatus(context, options = {}) {
  const durable = loadManagerPaseoConnection(context.repository, options)?.host || null;
  const legacy = legacySetupHost(context.repository, options);
  let last = null;
  for (const host of hostsFor(context.repository, options)) {
    const paseo = await connectionForHost(context, host, options);
    const probe = (options.probePaseo || probePaseoConnection)(paseo, options);
    const source = host === durable ? 'saved manager connection' : host === legacy ? 'migrated setup connection' : 'automatic discovery';
    last = publicProbe(probe, source);
    if (probe?.ok) {
      saveManagerPaseoConnection(context.repository, host, options);
      return last;
    }
    if (probe?.authentication?.required) return last;
  }
  return last || { source: 'automatic discovery', ok: false, host: null, cli: null, daemon: null, authentication: null, compatibility: null, diagnostic: 'No Paseo connection candidate could be checked.' };
}

export async function connectManagerPaseo(context, input = {}, options = {}) {
  const host = String(input.host || '').trim();
  if (!host || /\s|[?&]password=/i.test(host)) throw new Error('A valid Paseo host is required.');
  const password = String(input.password || '');
  const paseo = await connectionForHost(context, host, options, password || null);
  const probe = (options.probePaseo || probePaseoConnection)(paseo, options);
  if (!probe?.ok) {
    const message = probe?.authentication?.required
      ? (password ? 'Paseo rejected the supplied password.' : 'This Paseo daemon requires a password.')
      : probe?.compatibility?.reason || probe?.diagnostic || 'The Paseo daemon could not be verified at that host.';
    throw new Error(message);
  }
  if (password && options.credentialStore) {
    await options.credentialStore.write(host, password, { remember: input.remember !== false });
  }
  saveManagerPaseoConnection(context.repository, host, options);
  return publicProbe(probe, 'saved manager connection');
}
