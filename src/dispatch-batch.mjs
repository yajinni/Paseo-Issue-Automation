import path from 'node:path';
import { dispatchNextIssue } from './attempts.mjs';
import { activeCodingCount, dispatchNextFixJob } from './fix-jobs.mjs';
import { acquireLease, releaseLease } from './durable-lease.mjs';
import { loadConfig, statePaths } from './state.mjs';

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

export function dispatchAvailableIssues(root, {
  configLoader = loadConfig,
  dispatchIssue = dispatchNextIssue,
  dispatchFix = dispatchNextFixJob,
  activeCount = activeCodingCount,
} = {}) {
  const maximum = Math.max(1, Number(configLoader(root).maxActive) || 1);
  const lockFile = path.join(statePaths(root).root, 'coding-scheduler.lock');
  const lease = acquireLease(lockFile, {
    owner: `coding-scheduler-${process.pid}`,
    purpose: 'coding-dispatch',
    resource: root,
    ttlMs: 60_000,
  });
  if (!lease.acquired) return { claimed: false, reason: 'Another Paseo process owns the coding scheduler lease.' };
  try {
    const attempts = [];
    const results = [];
    while (activeCount(root) < maximum) {
      const fixResult = dispatchFix(root);
      if (fixResult?.claimed) {
        results.push({ type: 'fix', ...fixResult });
        attempts.push(...normalizedAttempt(fixResult, 'fix'));
        continue;
      }
      const issueResult = dispatchIssue(root);
      results.push({ type: 'issue', ...issueResult });
      attempts.push(...normalizedAttempt(issueResult, 'issue'));
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
