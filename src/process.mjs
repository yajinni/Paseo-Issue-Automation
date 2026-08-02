import { spawnSync } from 'node:child_process';

export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  const output = {
    ok: !result.error && result.status === 0,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null,
  };

  if (!output.ok && !options.allowFailure) {
    const detail = output.stderr || output.stdout || output.error?.message || `exit ${output.exitCode}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
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
    ? run('where', [command], { allowFailure: true })
    : run('sh', ['-lc', `command -v ${JSON.stringify(command)}`], { allowFailure: true });
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
