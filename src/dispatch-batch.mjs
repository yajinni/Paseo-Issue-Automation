import { dispatchNextIssue } from './attempts.mjs';
import { loadConfig } from './state.mjs';

function normalizedAttempt(result) {
  if (!result?.claimed) return [];
  if (Array.isArray(result.attempts)) return result.attempts;
  return [{
    claimed: true,
    issueNumber: result.issueNumber,
    branch: result.branch,
    attempt: result.attempt,
    controllerPid: result.controllerPid,
  }];
}

export function dispatchAvailableIssues(root, {
  configLoader = loadConfig,
  dispatchOne = dispatchNextIssue,
} = {}) {
  const maximum = Math.max(1, Number(configLoader(root).maxActive) || 1);
  const attempts = [];
  const results = [];
  for (let index = 0; index < maximum; index += 1) {
    const result = dispatchOne(root);
    results.push(result);
    attempts.push(...normalizedAttempt(result));
    if (!result?.claimed) break;
  }
  if (!attempts.length) return results[0] || { claimed: false, reason: 'No eligible ready issue found.' };
  return {
    claimed: true,
    issueNumber: attempts[0].issueNumber,
    branch: attempts[0].branch,
    attempts,
    dispatches: results,
  };
}
