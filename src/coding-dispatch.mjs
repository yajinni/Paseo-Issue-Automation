import path from 'node:path';
import { dispatchSpecificIssue, restartIssue } from './attempts.mjs';
import { acquireLease, releaseLease } from './durable-lease.mjs';
import { activeCodingCount } from './fix-jobs.mjs';
import { loadConfig, loadRun, statePaths } from './state.mjs';

function withCodingSchedulerLease(root, action) {
  const lockFile = path.join(statePaths(root).root, 'coding-scheduler.lock');
  const lease = acquireLease(lockFile, {
    owner: `coding-command-${process.pid}`,
    purpose: 'coding-command',
    resource: root,
    ttlMs: 60_000,
  });
  if (!lease.acquired) throw new Error('Another Paseo process owns the coding scheduler lease.');
  try { return action(); }
  finally { releaseLease(lockFile, lease.lease.id); }
}

function requireAvailableCodingSlot(root, { replacingRunningIssue = false } = {}) {
  const maximum = Math.max(1, Number(loadConfig(root).maxActive) || 1);
  const active = activeCodingCount(root);
  if (!replacingRunningIssue && active >= maximum) {
    throw new Error(`Maximum coding slot count reached (${active}/${maximum}).`);
  }
  if (replacingRunningIssue && active > maximum) {
    throw new Error(`Coding slot usage already exceeds the configured maximum (${active}/${maximum}).`);
  }
  return { active, maximum };
}

export function dispatchSpecificCodingIssue(root, number, options = {}) {
  return withCodingSchedulerLease(root, () => {
    requireAvailableCodingSlot(root);
    return dispatchSpecificIssue(root, number, options);
  });
}

export function restartCodingIssue(root, number, options = {}) {
  return withCodingSchedulerLease(root, () => {
    const state = loadRun(root, number);
    requireAvailableCodingSlot(root, { replacingRunningIssue: state?.status === 'agent-running' });
    return restartIssue(root, number, options);
  });
}
