import { spawnSync } from 'node:child_process';

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_AGENT_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function agentCommandTimeoutMs(env = process.env) {
  const configured = Number(env.PASEO_AGENT_TIMEOUT_MS ?? DEFAULT_AGENT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AGENT_TIMEOUT_MS;
}

function commandTimeout(options = {}) {
  const configured = Number(options.timeoutMs ?? process.env.PASEO_COMMAND_TIMEOUT_MS ?? DEFAULT_COMMAND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COMMAND_TIMEOUT_MS;
}

export function run(command, args = [], options = {}) {
  const timeoutMs = commandTimeout(options);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    maxBuffer: Number(options.maxBuffer || 16 * 1024 * 1024),
  });

  const timedOut = result.error?.code === 'ETIMEDOUT';
  const output = {
    ok: !result.error && result.status === 0,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null,
    timedOut,
    timeoutMs,
  };

  if (!output.ok && !options.allowFailure) {
    const detail = timedOut
      ? `timed out after ${timeoutMs}ms`
      : output.stderr || output.stdout || output.error?.message || `exit ${output.exitCode}`;
    const error = new Error(`${command} ${args.join(' ')} failed: ${detail}`);
    error.command = command;
    error.args = [...args];
    error.exitCode = output.exitCode;
    error.timedOut = timedOut;
    error.timeoutMs = timeoutMs;
    throw error;
  }

  return output;
}

export function runJson(command, args = [], options = {}) {
  const result = run(command, args, options);
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    if (options.allowFailure) return null;
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

export function commandAvailable(command) {
  const probe = process.platform === 'win32'
    ? run('where', [command], { allowFailure: true, timeoutMs: 10_000 })
    : run('sh', ['-lc', `command -v ${JSON.stringify(command)}`], { allowFailure: true, timeoutMs: 10_000 });
  return probe.ok;
}

export function findFirstKey(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findFirstKey(child, keys);
      if (found !== null) return found;
    }
  }
  return null;
}
