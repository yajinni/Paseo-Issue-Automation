import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwrightLibraryStatus } from './browser-service.mjs';
import { buildWindowsCmdInvocation, resolveCommand } from './process.mjs';

const INSTALL_TIMEOUT_MS = 15 * 60_000;

export function playwrightPackageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function npmInstallInvocation(args, {
  platform = process.platform,
  env = process.env,
  resolve = resolveCommand,
} = {}) {
  const command = npmCommand(platform);
  const resolution = resolve(command, { platform, env });
  if (!resolution?.available || !resolution.path) {
    throw new Error('npm is unavailable. Repair or reinstall Node.js with npm support, then retry Playwright installation.');
  }
  if (platform === 'win32') {
    return {
      ...buildWindowsCmdInvocation(resolution.path, args, env),
      env,
      resolvedCommand: resolution.path,
    };
  }
  return {
    executable: resolution.path,
    args: [...args],
    env,
    resolvedCommand: resolution.path,
    windowsVerbatimArguments: false,
  };
}

export function installPlaywrightLibrary(options = {}) {
  const libraryStatus = options.libraryStatus || playwrightLibraryStatus;
  const before = libraryStatus();
  if (before.installed) {
    return { installed: true, alreadyInstalled: true, modulePath: before.modulePath || null };
  }

  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const cwd = options.packageRoot || playwrightPackageRoot();
  const args = [
    'install',
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
  ];
  const invocation = npmInstallInvocation(args, {
    platform,
    env,
    resolve: options.resolve || resolveCommand,
  });
  const spawn = options.spawn || spawnSync;
  const result = spawn(invocation.executable, invocation.args, {
    cwd,
    env: invocation.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: Number(options.timeoutMs || INSTALL_TIMEOUT_MS),
    killSignal: 'SIGTERM',
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
  });

  if (result.error?.code === 'ETIMEDOUT') throw new Error('Playwright installation timed out.');
  if (result.error) throw new Error(`Unable to run npm: ${result.error.message}`);
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || 'npm could not install Paseo dependencies.').trim();
    throw new Error(`Playwright installation failed. ${output}`.trim());
  }

  const after = libraryStatus();
  if (!after.installed) {
    throw new Error('Playwright installation completed, but the Playwright library is still unavailable to Paseo.');
  }
  return {
    installed: true,
    alreadyInstalled: false,
    modulePath: after.modulePath || null,
    command: [npmCommand(platform), ...args],
    resolvedCommand: invocation.resolvedCommand,
    stdout: String(result.stdout || '').trim(),
  };
}
