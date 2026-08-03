import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const DEFAULT_TTL_MS = 120_000;

function iso(value) {
  return new Date(value).toISOString();
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function readLease(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function leaseExpired(lease, { now = Date.now(), requireLiveProcess = true } = {}) {
  if (!lease || !lease.expiresAt || Date.parse(lease.expiresAt) <= now) return true;
  if (requireLiveProcess && lease.pid && !processAlive(lease.pid)) return true;
  return false;
}

function writeLeaseFile(file, lease, exclusive) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (exclusive) {
    const descriptor = openSync(file, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`);
    closeSync(descriptor);
  } else {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(lease, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  }
  try { chmodSync(file, 0o600); } catch {}
}

export function acquireLease(file, {
  owner,
  pid = process.pid,
  purpose,
  resource,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
  metadata = null,
  requireLiveProcess = true,
} = {}) {
  const normalizedOwner = String(owner || `${pid}`);
  const existing = readLease(file);
  if (existing && !leaseExpired(existing, { now, requireLiveProcess })) {
    return { acquired: false, lease: existing };
  }
  if (existing) rmSync(file, { force: true });
  const lease = {
    id: `${normalizedOwner}:${randomUUID()}`,
    owner: normalizedOwner,
    pid: Number(pid) || process.pid,
    purpose: purpose || null,
    resource: resource || null,
    acquiredAt: iso(now),
    heartbeatAt: iso(now),
    expiresAt: iso(now + ttlMs),
    metadata: metadata || null,
  };
  try {
    writeLeaseFile(file, lease, true);
    return { acquired: true, lease };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { acquired: false, lease: readLease(file) };
  }
}

export function renewLease(file, leaseId, {
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
  metadata,
  owner,
  pid,
} = {}) {
  const lease = readLease(file);
  if (!lease || lease.id !== leaseId) throw new Error('The durable lease is no longer owned by this worker.');
  const updated = {
    ...lease,
    owner: owner === undefined ? lease.owner : String(owner),
    pid: pid === undefined ? lease.pid : Number(pid),
    heartbeatAt: iso(now),
    expiresAt: iso(now + ttlMs),
    metadata: metadata === undefined ? lease.metadata : metadata,
  };
  writeLeaseFile(file, updated, false);
  return updated;
}

export function transferLease(file, leaseId, { owner, pid = process.pid, ttlMs = DEFAULT_TTL_MS, metadata } = {}) {
  return renewLease(file, leaseId, { owner, pid, ttlMs, metadata });
}

export function startLeaseHeartbeat(file, leaseId, {
  ttlMs = DEFAULT_TTL_MS,
  intervalMs = Math.max(1_000, Math.floor(ttlMs / 3)),
  metadata,
  onError = () => {},
} = {}) {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    try { renewLease(file, leaseId, { ttlMs, metadata }); }
    catch (error) {
      stopped = true;
      clearInterval(timer);
      onError(error);
    }
  }, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function releaseLease(file, leaseId, { force = false } = {}) {
  const lease = readLease(file);
  if (!lease) return { released: false, reason: 'missing' };
  if (!force && lease.id !== leaseId) return { released: false, reason: 'not-owner', lease };
  rmSync(file, { force: true });
  return { released: true, lease };
}

export function clearExpiredLease(file, options = {}) {
  const lease = readLease(file);
  if (!lease || !leaseExpired(lease, options)) return { cleared: false, lease };
  const current = readLease(file);
  if (!current || current.id !== lease.id) return { cleared: false, lease: current };
  rmSync(file, { force: true });
  return { cleared: true, lease };
}
