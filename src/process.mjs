import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
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

function pathEntries(env = process.env) {
  return String(env.Path || env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function windowsExecutableNames(command, env = process.env) {
  if (path.extname(command)) return [command];
  const extensions = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

export function windowsPaseoCandidates(env = process.env) {
  const candidates = [];
  const push = (...parts) => {
    if (parts[0]) candidates.push(path.join(...parts));
  };
  push(env.LOCALAPPDATA, 'Programs', 'Paseo', 'resources', 'bin', 'paseo.cmd');
  push(env.LOCALAPPDATA, 'Programs', 'paseo', 'resources', 'bin', 'paseo.cmd');
  push(env.LOCALAPPDATA, 'Paseo', 'resources', 'bin', 'paseo.cmd');
  push(env.APPDATA, 'npm', 'paseo.cmd');
  push(env.ProgramFiles, 'Paseo', 'resources', 'bin', 'paseo.cmd');
  push(env['ProgramFiles(x86)'], 'Paseo', 'resources', 'bin', 'paseo.cmd');
  push(env.ProgramW6432, 'Paseo', 'resources', 'bin', 'paseo.cmd');
  return [...new Set(candidates)];
}

export function resolveCommand(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fileExists = options.existsSync || existsSync;
  const original = String(command || '').trim();
  if (!original) return { available: false, command: original, path: null, source: 'missing' };

  const hasPathSeparator = original.includes('/') || original.includes('\\') || path.isAbsolute(original);
  if (hasPathSeparator) {
    return fileExists(original)
      ? { available: true, command: original, path: original, source: 'explicit' }
      : { available: false, command: original, path: null, source: 'missing' };
  }

  if (platform === 'win32') {
    const names = windowsExecutableNames(original, env);
    for (const directory of pathEntries(env)) {
      for (const name of names) {
        const candidate = path.join(directory, name);
        if (fileExists(candidate)) return { available: true, command: original, path: candidate, source: 'path' };
      }
    }
    if (original.toLowerCase() === 'paseo') {
      for (const candidate of windowsPaseoCandidates(env)) {
        if (fileExists(candidate)) {
          const source = candidate.toLowerCase().includes(`${path.sep}npm${path.sep}`) ? 'npm-global' : 'paseo-desktop';
          return { available: true, command: original, path: candidate, source };
        }
      }
    }
    return { available: false, command: original, path: null, source: 'missing' };
  }

  const probe = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(original)}`], {
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  const resolved = String(probe.stdout || '').trim().split(/\r?\n/)[0];
  return probe.status === 0 && resolved
    ? { available: true, command: original, path: resolved, source: 'path' }
    : { available: false, command: original, path: null, source: 'missing' };
}

function quoteCmdArgument(value) {
  const text = String(value)
    .replace(/%/g, '%%')
    .replace(/"/g, '""');
  return `"${text}"`;
}

export function buildWindowsCmdInvocation(executable, args = [], env = process.env) {
  const commandLine = `call ${[executable, ...args].map(quoteCmdArgument).join(' ')}`;
  return {
    executable: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', commandLine],
    // Node otherwise re-escapes the quotes in the /c payload before handing it
    // to cmd.exe. Passing the command line verbatim keeps the quoted path and
    // arguments intact. Starting with `call` also avoids cmd's special handling
    // for a /c payload whose first character is a quote.
    windowsVerbatimArguments: true,
  };
}

function findGitMarker(cwd) {
  let current = path.resolve(cwd || process.cwd());
  for (;;) {
    const marker = path.join(current, '.git');
    if (existsSync(marker)) return marker;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function gitCommonDirectory(cwd) {
  try {
    const marker = findGitMarker(cwd);
    if (!marker) return null;
    let gitDirectory = marker;
    if (!statSync(marker).isDirectory()) {
      const match = /^gitdir:\s*(.+)$/im.exec(readFileSync(marker, 'utf8'));
      if (!match) return null;
      gitDirectory = path.resolve(path.dirname(marker), match[1].trim());
    }
    const commonFile = path.join(gitDirectory, 'commondir');
    if (!existsSync(commonFile)) return gitDirectory;
    return path.resolve(gitDirectory, readFileSync(commonFile, 'utf8').trim());
  } catch {
    return null;
  }
}

function automationConfig(cwd) {
  try {
    const commonDirectory = gitCommonDirectory(cwd);
    if (!commonDirectory) return null;
    const file = path.join(commonDirectory, 'paseo-issue-automation', 'config.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function runRole(args) {
  const titleIndex = args.indexOf('--title');
  const title = titleIndex >= 0 ? String(args[titleIndex + 1] || '') : '';
  if (/\breviewer\b/i.test(title)) return 'reviewer';
  if (/\bcoder\b|\bfix(?:es)?\b/i.test(title)) return 'coder';
  return null;
}

export function paseoRunArgsWithThinking(args = [], options = {}) {
  const next = [...args];
  if (next[0] !== 'run' || next.includes('--thinking')) return next;
  const role = runRole(next);
  if (!role) return next;
  const config = options.config || automationConfig(options.cwd);
  const thinking = String(config?.models?.[`${role}Thinking`] || '').trim();
  if (!thinking || /\s/.test(thinking)) return next;
  const providerIndex = next.indexOf('--provider');
  const insertionIndex = providerIndex >= 0 ? providerIndex + 2 : 1;
  next.splice(insertionIndex, 0, '--thinking', thinking);
  return next;
}

function resolvedSpawn(command, args, options) {
  const env = options.env || process.env;
  const resolution = process.platform === 'win32' && String(command).toLowerCase() === 'paseo'
    ? resolveCommand(command, { env })
    : { available: true, command, path: command, source: 'direct' };
  const executable = resolution.path || command;

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return {
      ...buildWindowsCmdInvocation(executable, args, env),
      resolution,
    };
  }
  return { executable, args, resolution };
}

export function run(command, args = [], options = {}) {
  const timeoutMs = commandTimeout(options);
  const env = options.env || process.env;
  const effectiveArgs = String(command).toLowerCase() === 'paseo'
    ? paseoRunArgsWithThinking(args, { cwd: options.cwd })
    : [...args];
  const resolved = resolvedSpawn(command, effectiveArgs, { ...options, env });
  const result = spawnSync(resolved.executable, resolved.args, {
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: resolved.windowsVerbatimArguments === true,
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
    resolvedCommand: resolved.resolution.path || String(command),
    resolutionSource: resolved.resolution.source,
  };

  if (!output.ok && !options.allowFailure) {
    const detail = timedOut
      ? `timed out after ${timeoutMs}ms`
      : output.stderr || output.stdout || output.error?.message || `exit ${output.exitCode}`;
    const error = new Error(`${command} ${effectiveArgs.join(' ')} failed: ${detail}`);
    error.command = command;
    error.args = [...effectiveArgs];
    error.exitCode = output.exitCode;
    error.timedOut = timedOut;
    error.timeoutMs = timeoutMs;
    error.resolvedCommand = output.resolvedCommand;
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

export function commandAvailable(command, options = {}) {
  return resolveCommand(command, options).available;
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
