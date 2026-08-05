import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLease, clearExpiredLease, readLease, releaseLease, renewLease } from './durable-lease.mjs';
import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';

function applicationDataRoot(env = process.env, platform = process.platform) {
  if (platform === 'win32') return env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

export function browserPaths(options = {}) {
  const root = path.join(options.dataRoot || applicationDataRoot(options.env, options.platform), 'paseo', 'pr-review');
  const profile = path.join(root, 'chatgpt-profile');
  const diagnostics = path.join(root, 'diagnostics');
  for (const directory of [root, profile, diagnostics]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch {}
  }
  return {
    root,
    profile,
    diagnostics,
    config: path.join(root, 'browser-config.json'),
    lock: path.join(root, 'browser-profile.lock'),
    reviewSchedulerLock: path.join(root, 'review-scheduler.lock'),
  };
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicConfigWrite(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, file);
  try { chmodSync(file, 0o600); } catch {}
}

export function loadBrowserConfig(options = {}) {
  const file = browserPaths(options).config;
  const stored = readJson(file, {});
  let globalConversationUrl = null;
  if (stored.globalConversationUrl) {
    try { globalConversationUrl = normalizeChatGptConversationUrl(stored.globalConversationUrl); } catch {}
  }
  return {
    version: 1,
    globalConversationUrl,
    lastConversationUrl: stored.lastConversationUrl || null,
    lastAuthenticatedAt: stored.lastAuthenticatedAt || null,
    browserInstalledAt: stored.browserInstalledAt || null,
    updatedAt: stored.updatedAt || null,
  };
}

export function saveBrowserConfig(input, options = {}) {
  const paths = browserPaths(options);
  const current = loadBrowserConfig(options);
  const config = {
    ...current,
    ...input,
    version: 1,
    globalConversationUrl: input.globalConversationUrl === undefined
      ? current.globalConversationUrl
      : input.globalConversationUrl ? normalizeChatGptConversationUrl(input.globalConversationUrl) : null,
    lastConversationUrl: input.lastConversationUrl === undefined
      ? current.lastConversationUrl
      : input.lastConversationUrl ? normalizeChatGptConversationUrl(input.lastConversationUrl) : null,
    updatedAt: new Date().toISOString(),
  };
  atomicConfigWrite(paths.config, config);
  return config;
}

export function acquireBrowserProfileLease({ owner, purpose, ttlMs = 180_000, metadata, ...options } = {}) {
  const paths = browserPaths(options);
  clearExpiredLease(paths.lock);
  return acquireLease(paths.lock, {
    owner: owner || `${process.pid}`,
    purpose: purpose || 'chatgpt-browser',
    resource: 'dedicated-chatgpt-profile',
    ttlMs,
    metadata,
  });
}

export function renewBrowserProfileLease(leaseId, { ttlMs = 180_000, metadata, ...options } = {}) {
  return renewLease(browserPaths(options).lock, leaseId, { ttlMs, metadata });
}

export function releaseBrowserProfileLease(leaseId, options = {}) {
  return releaseLease(browserPaths(options).lock, leaseId, options);
}

export function browserProfileStatus(options = {}) {
  const paths = browserPaths(options);
  clearExpiredLease(paths.lock);
  const lease = readLease(paths.lock);
  const config = loadBrowserConfig(options);
  return {
    profileExists: existsSync(paths.profile),
    configExists: existsSync(paths.config),
    locked: Boolean(lease),
    lease: lease ? {
      purpose: lease.purpose || null,
      acquiredAt: lease.acquiredAt || null,
      heartbeatAt: lease.heartbeatAt || null,
      expiresAt: lease.expiresAt || null,
    } : null,
    globalConversationConfigured: Boolean(config.globalConversationUrl),
    lastAuthenticatedAt: config.lastAuthenticatedAt,
    browserInstalledAt: config.browserInstalledAt,
  };
}

export function resetBrowserProfile(options = {}) {
  const paths = browserPaths(options);
  clearExpiredLease(paths.lock);
  const lease = readLease(paths.lock);
  if (lease) throw new Error('The dedicated browser profile is currently in use.');
  rmSync(paths.profile, { recursive: true, force: true });
  mkdirSync(paths.profile, { recursive: true, mode: 0o700 });
  try { chmodSync(paths.profile, 0o700); } catch {}
  return { reset: true };
}

export function uninstallBrowserState(options = {}) {
  const paths = browserPaths(options);
  clearExpiredLease(paths.lock);
  clearExpiredLease(paths.reviewSchedulerLock, { requireLiveProcess: false });
  const profileLease = readLease(paths.lock);
  const reviewLease = readLease(paths.reviewSchedulerLock);
  if (profileLease || reviewLease) throw new Error('The dedicated browser or serial review scheduler is currently in use.');

  const config = saveBrowserConfig({ browserInstalledAt: null }, options);
  return {
    chromiumStateCleared: true,
    profilePreserved: existsSync(paths.profile),
    configPreserved: existsSync(paths.config),
    credentialsPreserved: Boolean(config.lastAuthenticatedAt),
    conversationPreserved: Boolean(config.globalConversationUrl || config.lastConversationUrl),
  };
}
