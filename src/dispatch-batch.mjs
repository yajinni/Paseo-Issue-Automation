import path from 'node:path';
import { dispatchNextIssue, resumePendingAgentLaunches } from './attempts.mjs';
import { activeCodingCount, dispatchNextFixJob } from './fix-jobs.mjs';
import { acquireLease, releaseLease, renewLease } from './durable-lease.mjs';
import { loadConfig, statePaths } from './state.mjs';

const CODING_SCHEDULER_TTL_MS = 30 * 60_000;

function normalizedAttempt(result, type) {
  if (!result?.claimed) return [];
  if (Array.isArray(result.attempts)) return result.attempts;
  return [{
    claimed: true,
    type,
    issueNumber: result.issueNumber,
    pullRequestNumber: result.pullRequestNumber,
    branch: result.branch,
    attempt: result.attempt,
    controllerPid: result.controllerPid,
    jobId: result.jobId,
  }];
}

function normalizedClaimLimit(value) {
  if (value === undefined || value === null) return Number.POSITIVE_INFINITY;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('maxClaims must be a positive integer.');
  return limit;
}

export function dispatchAvailableIssues(root, {
  configLoader = loadConfig,
  dispatchIssue = dispatchNextIssue,
  dispatchFix = dispatchNextFixJob,
  activeCount = activeCodingCount,
  resumeLaunches = resumePendingAgentLaunches,
  maxClaims = null,
} = {}) {
  const maximum = Math.max(1, Number(configLoader(root).maxActive) || 1);
  const claimLimit = normalizedClaimLimit(maxClaims);
  const lockFile = path.join(statePaths(root).root, 'coding-scheduler.lock');
  const lease = acquireLease(lockFile, {
    owner: `coding-scheduler-${process.pid}`,
    purpose: 'coding-dispatch',
    resource: root,
    ttlMs: CODING_SCHEDULER_TTL_MS,
  });
  if (!lease.acquired) return { claimed: false, reason: 'Another Paseo process owns the coding scheduler lease.' };
  const renew = (metadata) => renewLease(lockFile, lease.lease.id, {
    ttlMs: CODING_SCHEDULER_TTL_MS,
    metadata,
  });
  try {
    const resumed = resumeLaunches(root);
    const attempts = normalizedAttempt(resumed, 'launch-retry');
    const results = resumed?.results?.length || resumed?.attempts?.length
      ? [{ type: 'launch-retry', ...resumed }]
      : [];
    if (resumed?.haltDispatch) {
      return {
        claimed: attempts.length > 0,
        issueNumber: attempts[0]?.issueNumber,
        branch: attempts[0]?.branch,
        attempts,
        dispatches: results,
        haltDispatch: true,
        reason: resumed.reason || 'An existing workspace launch requires attention.',
      };
    }
    while (attempts.length < claimLimit) {
      renew({ phase: 'counting-capacity', claimed: attempts.length });
      if (activeCount(root) >= maximum) break;
      renew({ phase: 'dispatching-fix', claimed: attempts.length });
      const fixResult = dispatchFix(root);
      if (fixResult?.claimed) {
        results.push({ type: 'fix', ...fixResult });
        attempts.push(...normalizedAttempt(fixResult, 'fix'));
        renew({ phase: 'fix-dispatched', claimed: attempts.length });
        continue;
      }
      renew({ phase: 'dispatching-issue', claimed: attempts.length });
      const issueResult = dispatchIssue(root);
      results.push({ type: 'issue', ...issueResult });
      attempts.push(...normalizedAttempt(issueResult, 'issue'));
      renew({ phase: 'issue-dispatch-complete', claimed: attempts.length });
      if (!issueResult?.claimed) break;
    }
    if (!attempts.length) return results[0] || { claimed: false, reason: 'No eligible coding job found.' };
    return {
      claimed: true,
      issueNumber: attempts[0].issueNumber,
      pullRequestNumber: attempts[0].pullRequestNumber,
      branch: attempts[0].branch,
      attempts,
      dispatches: results,
    };
  } finally {
    releaseLease(lockFile, lease.lease.id);
  }
}
