import fs from 'node:fs';
import path from 'node:path';
import { run as defaultRunner } from './process.mjs';

const CONTROLLER_WORKERS = new Set(['controller-worker.mjs', 'recovery-controller-worker.mjs']);
const PROCESS_QUERY_TIMEOUT_MS = 2_000;

function positivePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function controllerProcessAlive(value) {
  const pid = positivePid(value);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function tokenize(commandLine) {
  if (Array.isArray(commandLine)) return commandLine.map((value) => String(value));
  const args = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(commandLine || '')))) args.push(match[1] ?? match[2]);
  return args;
}

function workerName(value) {
  return String(value || '').replaceAll('\\', '/').split('/').pop()?.toLowerCase() || '';
}

function normalizePath(value, platform) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalized = pathApi.normalize(pathApi.resolve(raw)).replaceAll('\\', '/');
  const withoutTrailingSlash = normalized.replace(/\/$/, '');
  return platform === 'win32' ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash;
}

function processCommandLine(pid, { platform, runner }) {
  if (platform === 'win32') {
    const script = `$process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}"; if ($process) { $process.CommandLine }`;
    const result = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      allowFailure: true,
      timeoutMs: PROCESS_QUERY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return result?.ok ? result.stdout : '';
  }

  if (platform === 'linux') {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch {
      return '';
    }
  }

  const result = runner('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
    allowFailure: true,
    timeoutMs: PROCESS_QUERY_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return result?.ok ? result.stdout : '';
}

export function controllerProcessIsLiveForRun(root, run = {}, {
  platform = process.platform,
  runner = defaultRunner,
  processAlive = controllerProcessAlive,
  commandLineReader = null,
} = {}) {
  const pid = positivePid(run.controllerPid);
  if (!pid || !processAlive(pid)) return false;

  let commandLine;
  try {
    commandLine = commandLineReader
      ? commandLineReader(pid, { platform })
      : processCommandLine(pid, { platform, runner });
  } catch {
    return false;
  }

  const args = tokenize(commandLine);
  const workerIndex = args.findIndex((value) => CONTROLLER_WORKERS.has(workerName(value)));
  if (workerIndex < 0) return false;

  const commandRoot = args[workerIndex + 1];
  const commandIssue = args[workerIndex + 2];
  if (normalizePath(commandRoot, platform) !== normalizePath(root, platform)) return false;
  if (Number(commandIssue) !== Number(run.issueNumber)) return false;

  const expectedAttempt = positivePid(run.attempt);
  const commandAttempt = args[workerIndex + 3];
  if (expectedAttempt) {
    if (!commandAttempt || Number(commandAttempt) !== expectedAttempt) return false;
    return true;
  }

  // A genuinely legacy run has no persisted attempt identity to compare. Root and issue
  // are the strongest available ownership evidence for that compatibility case.
  return true;
}
