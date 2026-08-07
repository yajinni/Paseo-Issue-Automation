import { run as defaultRun, runJson as defaultRunJson } from '../process.mjs';

export const DEFAULT_PASEO_HOST = '127.0.0.1:6767';
export const LOCAL_PASEO_HOST_CANDIDATES = Object.freeze([
  DEFAULT_PASEO_HOST,
  'localhost:6767',
  'host.docker.internal:6767',
  'gateway.docker.internal:6767',
]);

function cleanHost(value) {
  const host = String(value || '').trim();
  if (!host) return null;
  if (/\s|[\r\n]/.test(host)) throw new Error('Paseo host is invalid.');
  if (/[?&]password=/i.test(host)) throw new Error('Paseo host must not contain a password.');
  return host;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function paseoHostCandidates({ savedHost = null, containerized = false } = {}) {
  const candidates = [cleanHost(savedHost), DEFAULT_PASEO_HOST, 'localhost:6767'];
  if (containerized) candidates.push('host.docker.internal:6767', 'gateway.docker.internal:6767');
  return unique(candidates);
}

function redactString(input, secrets = []) {
  let value = String(input || '');
  value = value.replace(/([?&]password=)[^&#\s]*/gi, '$1[REDACTED]');
  value = value.replace(/(authorization\s*:\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]');
  for (const secret of secrets) {
    const normalized = String(secret || '');
    if (normalized) value = value.split(normalized).join('[REDACTED]');
  }
  return value;
}

export function redactSensitive(value, secrets = []) {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, secrets));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (/(?:password|token|cookie|authorization|secret|credential)/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactSensitive(child, secrets);
      }
    }
    return output;
  }
  return value;
}

function safeResult(result, password) {
  if (!result || typeof result !== 'object') return result;
  return redactSensitive({
    ok: result.ok === true,
    exitCode: result.exitCode ?? null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.timedOut === true,
    resolvedCommand: result.resolvedCommand || null,
    resolutionSource: result.resolutionSource || null,
  }, [password]);
}

export function createPaseoConnectionContext({
  host,
  password = null,
  cwd,
  env = process.env,
  run = defaultRun,
  runJson = defaultRunJson,
} = {}) {
  const normalizedHost = cleanHost(host);
  if (!normalizedHost) throw new Error('A Paseo host is required.');
  const isolatedEnv = { ...env };
  delete isolatedEnv.PASEO_PASSWORD;
  isolatedEnv.PASEO_HOST = normalizedHost;
  if (password) isolatedEnv.PASEO_PASSWORD = String(password);

  function command(args = [], options = {}) {
    const result = run('paseo', [...args], {
      cwd,
      ...options,
      env: isolatedEnv,
      allowFailure: options.allowFailure ?? true,
    });
    return safeResult(result, password);
  }

  function json(args = [], options = {}) {
    try {
      const result = runJson('paseo', [...args], {
        cwd,
        ...options,
        env: isolatedEnv,
        allowFailure: options.allowFailure ?? true,
      });
      return redactSensitive(result, [password]);
    } catch (error) {
      const safe = new Error(redactString(error.message, [password]));
      safe.code = error.code;
      throw safe;
    }
  }

  return Object.freeze({
    host: normalizedHost,
    authenticated: Boolean(password),
    command,
    json,
  });
}

function firstVersion(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['daemonVersion', 'version', 'serverVersion']) {
    if (value[key]) return String(value[key]);
  }
  for (const child of Object.values(value)) {
    const found = firstVersion(child);
    if (found) return found;
  }
  return null;
}

export function probePaseoConnection(context, { run = defaultRun } = {}) {
  const cli = run('paseo', ['--version'], { allowFailure: true });
  const cliVersion = String(cli.stdout || cli.stderr || '').trim() || null;

  const daemonStatus = context.json(['daemon', 'status', '--json'], { allowFailure: true });
  const workspaceProbe = context.command(['workspace', 'ls', '--json'], { allowFailure: true });
  const daemonReachable = workspaceProbe?.ok === true;
  const daemonVersion = firstVersion(daemonStatus);
  const authRequired = !daemonReachable && /(?:401|unauthori[sz]ed|password|authentication)/i.test(
    `${workspaceProbe?.stderr || ''}\n${workspaceProbe?.stdout || ''}`,
  );

  return {
    ok: daemonReachable,
    host: context.host,
    authentication: {
      required: authRequired,
      supplied: context.authenticated,
      ok: daemonReachable,
    },
    cli: {
      ok: cli.ok === true,
      version: cliVersion,
      path: cli.resolvedCommand || null,
    },
    daemon: {
      reachable: daemonReachable,
      version: daemonVersion,
    },
    compatibility: {
      ok: daemonReachable && cli.ok === true,
      reason: daemonReachable && cli.ok === true ? null : 'Paseo CLI or daemon is not ready.',
    },
    diagnostic: workspaceProbe,
  };
}

export function discoverPaseoConnection({
  savedHost = null,
  manualHost = null,
  password = null,
  containerized = false,
  contextFactory = createPaseoConnectionContext,
  probe = probePaseoConnection,
  ...contextOptions
} = {}) {
  const automaticHosts = paseoHostCandidates({ savedHost, containerized });
  const attempts = [];
  for (const host of automaticHosts) {
    const context = contextFactory({ ...contextOptions, host, password });
    const result = probe(context, contextOptions);
    attempts.push(result);
    if (result.ok || result.authentication?.required) {
      return { found: result.ok, needsAuthentication: result.authentication?.required === true, result, attempts, manualAllowed: false };
    }
  }

  const manual = cleanHost(manualHost);
  if (manual) {
    const context = contextFactory({ ...contextOptions, host: manual, password });
    const result = probe(context, contextOptions);
    attempts.push(result);
    return { found: result.ok, needsAuthentication: result.authentication?.required === true, result, attempts, manualAllowed: true };
  }

  return { found: false, needsAuthentication: false, result: null, attempts, manualAllowed: true };
}
