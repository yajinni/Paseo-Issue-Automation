import { run } from './process.mjs';

const DEFAULT_PROBE_TIMEOUT_MS = 6_000;
const DEFAULT_CATALOG_COMMAND_TIMEOUT_MS = 12_000;
const DEFAULT_CATALOG_TOTAL_TIMEOUT_MS = 35_000;

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}

  const candidates = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const index of candidates) {
    try { return JSON.parse(text.slice(index)); } catch {}
  }
  return null;
}

function commandMessage(result, fallback) {
  if (result?.timedOut) return `${fallback || 'Command'} timed out after ${result.timeoutMs}ms.`;
  return String(result?.stderr || result?.stdout || result?.error?.message || fallback || '').trim();
}

function runJsonCommand(runner, command, args, options = {}) {
  const result = runner(command, args, { ...options, allowFailure: true });
  return { result, data: result?.ok ? parseJsonOutput(result.stdout) : null };
}

function normalizedEnabled(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return !['false', 'disabled', 'no', '0'].includes(text);
}

function normalizedAvailable(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !['error', 'unavailable', 'disabled'].includes(text);
}

export function probePaseo(root, { runner = run, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const attempts = [];
  const daemon = runJsonCommand(runner, 'paseo', ['daemon', 'status', '--json'], { cwd: root, timeoutMs });
  attempts.push({ command: 'paseo daemon status --json', ok: daemon.result?.ok === true, message: commandMessage(daemon.result) });

  if (daemon.data && typeof daemon.data === 'object' && !Array.isArray(daemon.data)) {
    const connected = String(daemon.data.connectedDaemon || '').toLowerCase();
    if (connected) {
      const reachable = connected === 'reachable';
      const note = daemon.data.note ? ` ${daemon.data.note}` : '';
      return {
        reachable,
        method: 'daemon-status',
        message: reachable
          ? `Paseo daemon is reachable${daemon.data.daemonVersion ? ` (v${daemon.data.daemonVersion})` : ''}.`
          : `Paseo daemon reports ${connected}.${note}`.trim(),
        status: daemon.data,
        attempts,
      };
    }
  }

  const fallbacks = [
    ['workspace', 'ls', '--json'],
    ['ls', '-a', '-g', '--json'],
  ];
  for (const args of fallbacks) {
    const probe = runJsonCommand(runner, 'paseo', args, { cwd: root, timeoutMs });
    attempts.push({ command: `paseo ${args.join(' ')}`, ok: probe.result?.ok === true, message: commandMessage(probe.result) });
    if (probe.result?.ok && probe.data !== null) {
      return {
        reachable: true,
        method: `compat-${args[0]}`,
        message: `Paseo responded to ${args.join(' ')}. Consider updating Paseo to use the daemon-status probe.`,
        status: probe.data,
        attempts,
      };
    }
  }

  const detail = attempts.map((attempt) => attempt.message).filter(Boolean).at(-1);
  return {
    reachable: false,
    method: 'unreachable',
    message: detail || 'Paseo CLI was found, but no daemon probe succeeded.',
    status: daemon.data,
    attempts,
  };
}

function branchLines(result) {
  if (!result?.ok) return [];
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function discoverBranches(root, { runner = run } = {}) {
  const currentResult = runner('git', ['branch', '--show-current'], { cwd: root, allowFailure: true, timeoutMs: 5_000 });
  const localResult = runner('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: root, allowFailure: true, timeoutMs: 5_000 });
  const remoteResult = runner('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], { cwd: root, allowFailure: true, timeoutMs: 5_000 });
  const current = currentResult?.ok ? String(currentResult.stdout || '').trim() : '';
  const records = new Map();

  for (const name of branchLines(localResult)) {
    records.set(name, { name, local: true, remote: false, current: name === current });
  }
  for (const ref of branchLines(remoteResult)) {
    if (ref === 'origin/HEAD' || ref.endsWith('/HEAD')) continue;
    const name = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
    const existing = records.get(name) || { name, local: false, remote: false, current: name === current };
    existing.remote = true;
    records.set(name, existing);
  }
  if (current && !records.has(current)) records.set(current, { name: current, local: true, remote: false, current: true });

  const branches = [...records.values()].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (left.local !== right.local) return left.local ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return {
    current: current || null,
    branches,
    errors: [
      !localResult?.ok ? commandMessage(localResult, 'Could not list local branches.') : null,
      !remoteResult?.ok ? commandMessage(remoteResult, 'Could not list origin branches.') : null,
    ].filter(Boolean),
  };
}

function providerRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.entries)) return data.entries;
  if (Array.isArray(data?.providers)) return data.providers;
  if (Array.isArray(data?.result?.data)) return data.result.data;
  if (Array.isArray(data?.result?.entries)) return data.result.entries;
  return [];
}

function modelRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.entries)) return data.entries;
  if (Array.isArray(data?.result?.data)) return data.result.data;
  if (Array.isArray(data?.result?.models)) return data.result.models;
  return [];
}

export function discoverPaseoCatalog(root, {
  runner = run,
  commandTimeoutMs = DEFAULT_CATALOG_COMMAND_TIMEOUT_MS,
  totalTimeoutMs = DEFAULT_CATALOG_TOTAL_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const remaining = () => Math.max(0, totalTimeoutMs - (Date.now() - startedAt));
  const commandTimeout = () => Math.max(1, Math.min(commandTimeoutMs, remaining()));

  const listed = runJsonCommand(runner, 'paseo', ['provider', 'ls', '--json'], {
    cwd: root,
    timeoutMs: commandTimeout(),
  });
  if (!listed.result?.ok || !listed.data) {
    return {
      providers: [],
      errors: [commandMessage(listed.result, 'Could not list Paseo providers.')],
      skipped: false,
      complete: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const rows = providerRows(listed.data);
  const providers = [];
  const errors = [];
  if (!rows.length) errors.push('Paseo provider ls returned no provider records.');

  const eligible = rows.filter((row) => {
    const id = String(row.provider || row.id || '').trim();
    return id && normalizedEnabled(row.enabled) && normalizedAvailable(row.status);
  });

  const excluded = rows.filter((row) => {
    const id = String(row.provider || row.id || '').trim();
    return id && !eligible.includes(row);
  });
  for (const row of excluded) {
    const id = String(row.provider || row.id || '').trim();
    errors.push(`${id}: provider is ${String(row.status || 'unavailable')} and ${normalizedEnabled(row.enabled) ? 'enabled' : 'disabled'}.`);
  }

  for (const row of eligible) {
    const id = String(row.provider || row.id || '').trim();
    if (remaining() <= 0) {
      errors.push(`Catalog refresh reached its ${totalTimeoutMs}ms safety limit before ${id} could be queried.`);
      break;
    }
    const modelsResult = runJsonCommand(runner, 'paseo', ['provider', 'models', id, '--thinking', '--json'], {
      cwd: root,
      timeoutMs: commandTimeout(),
    });
    if (!modelsResult.result?.ok || !modelsResult.data) {
      const error = `${id}: ${commandMessage(modelsResult.result, 'Could not list models.')}`;
      errors.push(error);
      providers.push({
        id,
        label: String(row.label || id),
        status: String(row.status || 'available'),
        models: [],
        error,
      });
      continue;
    }
    const models = modelRows(modelsResult.data)
      .map((model) => {
        const modelId = String(model.id || model.model || '').trim();
        if (!modelId) return null;
        return {
          id: modelId,
          label: String(model.model || model.label || modelId),
          description: String(model.description || ''),
          thinkingOptionIds: Array.isArray(model.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [],
          defaultThinkingOptionId: model.defaultThinkingOptionId == null ? null : String(model.defaultThinkingOptionId),
          value: `${id}/${modelId}`,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label));
    providers.push({
      id,
      label: String(row.label || id),
      status: String(row.status || 'available'),
      defaultMode: row.defaultMode || row.defaultModeId || null,
      modes: row.modes || [],
      models,
      error: models.length ? null : `${id}: Paseo reported no models.`,
    });
    if (!models.length) errors.push(`${id}: Paseo reported no models.`);
  }

  providers.sort((left, right) => left.label.localeCompare(right.label));
  return {
    providers,
    errors,
    skipped: false,
    complete: providers.length === eligible.length && errors.length === 0,
    elapsedMs: Date.now() - startedAt,
  };
}

export function discoverSetupOptions(root, options = {}) {
  const paseo = options.paseoOverride || probePaseo(root, options);
  const branches = discoverBranches(root, options);
  let catalog;
  if (!options.includeCatalog) {
    catalog = {
      providers: [],
      errors: paseo.reachable ? [] : [paseo.message],
      skipped: true,
      complete: false,
      elapsedMs: 0,
    };
  } else {
    catalog = paseo.reachable
      ? discoverPaseoCatalog(root, options)
      : { providers: [], errors: [paseo.message], skipped: false, complete: false, elapsedMs: 0 };
  }
  return {
    generatedAt: new Date().toISOString(),
    paseo,
    branches,
    catalog,
  };
}

export { parseJsonOutput };
