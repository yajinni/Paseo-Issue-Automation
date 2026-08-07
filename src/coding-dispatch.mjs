import path from 'node:path';
import { recoverFailedAttempt } from './attempt-recovery.mjs';
import { dispatchSpecificIssue, restartIssue } from './attempts.mjs';
import { acquireLease, releaseLease, renewLease } from './durable-lease.mjs';
import { activeCodingCount } from './fix-jobs.mjs';
import { appendIssueLifecycle, loadConfig, loadRun, statePaths } from './state.mjs';

const CODING_COMMAND_TTL_MS = 30 * 60_000;

function withCodingSchedulerLease(root, action) {
  const lockFile = path.join(statePaths(root).root, 'coding-scheduler.lock');
  const lease = acquireLease(lockFile, {
    owner: `coding-command-${process.pid}`,
    purpose: 'coding-command',
    resource: root,
    ttlMs: CODING_COMMAND_TTL_MS,
  });
  if (!lease.acquired) throw new Error('Another Paseo process owns the coding scheduler lease.');
  try {
    renewLease(lockFile, lease.lease.id, {
      ttlMs: CODING_COMMAND_TTL_MS,
      metadata: { phase: 'manual-coding-command' },
    });
    return action();
  } finally {
    releaseLease(lockFile, lease.lease.id);
  }
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

export function recoverOrRestartCodingIssue(root, number, options = {}) {
  return withCodingSchedulerLease(root, () => {
    const issueNumber = Number(number);
    const state = loadRun(root, issueNumber);
    requireAvailableCodingSlot(root, { replacingRunningIssue: state?.status === 'agent-running' });
    const branchAction = options.branchAction || 'keep';
    appendIssueLifecycle(root, issueNumber, {
      attempt: state?.attempt || null,
      type: 'recover-first-requested',
      status: 'started',
      source: 'operator',
      message: 'Recover-first restart requested.',
      evidence: {
        branchAction,
        previousStatus: state?.status || null,
        previousPhase: state?.phase || null,
        branch: state?.branch || null,
        workspaceId: state?.workspaceId || null,
        coderAgentId: state?.coderAgentId || state?.agentId || null,
      },
    });
    const recovery = recoverFailedAttempt(root, issueNumber, { branchAction });
    if (recovery.recovered) {
      appendIssueLifecycle(root, issueNumber, {
        attempt: recovery.attempt || state?.attempt || null,
        type: 'recover-first-reused-attempt',
        status: 'success',
        source: 'controller',
        message: 'Recovered the existing failed attempt instead of creating a fresh attempt.',
        evidence: {
          branch: recovery.branch || null,
          workspaceId: recovery.workspaceId || null,
          coderAgentId: recovery.coderAgentId || null,
          controllerPid: recovery.controllerPid || null,
        },
      });
      return recovery;
    }
    appendIssueLifecycle(root, issueNumber, {
      attempt: state?.attempt || null,
      type: 'recover-first-fallback',
      status: 'skipped',
      source: 'controller',
      message: recovery.reason || 'Existing attempt could not be safely reused; starting fresh.',
      evidence: {
        branchAction,
        branch: state?.branch || null,
        workspaceId: state?.workspaceId || null,
        coderAgentId: state?.coderAgentId || state?.agentId || null,
      },
    });
    const fresh = restartIssue(root, issueNumber, options);
    return {
      ...fresh,
      recovered: false,
      recoveryFallbackReason: recovery.reason || null,
    };
  });
}
