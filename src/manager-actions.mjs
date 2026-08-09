import { setClaimsEnabled } from './automation.mjs';
import {
  abandonAttempt,
  reconcileDependencies,
  skipIssue,
  unskipIssue,
  updateManagedDispatch,
} from './attempts.mjs';
import { dispatchSpecificCodingIssue } from './coding-dispatch.mjs';
import { dispatchAvailableIssues } from './dispatch-batch.mjs';
import { queueCodingIssueRestart } from './manager-restart.mjs';
import { setReviewQueuePaused } from './pr-review-store.mjs';
import { mergeRepositoryConfig } from './setup-wizard/schema.mjs';
import { loadConfig, saveConfig } from './state.mjs';

const defaultActions = {
  setClaimsEnabled,
  setReviewQueuePaused,
  abandonAttempt,
  reconcileDependencies,
  skipIssue,
  unskipIssue,
  updateManagedDispatch,
  dispatchSpecificCodingIssue,
  queueCodingIssueRestart,
  dispatchAvailableIssues,
  loadConfig,
  saveConfig,
};

function issueNumber(body) {
  const value = Number(body?.issueNumber);
  if (!Number.isInteger(value) || value <= 0) throw new Error('A positive issueNumber is required.');
  return value;
}

export function managerRepositoryAction(root, pathname, body = {}, actions = defaultActions) {
  if (pathname === '/api/pause') return actions.setClaimsEnabled(root, false);
  if (pathname === '/api/resume') return actions.setClaimsEnabled(root, true);
  if (pathname === '/api/pr-review/pause') return actions.setReviewQueuePaused(root, true);
  if (pathname === '/api/pr-review/resume') return actions.setReviewQueuePaused(root, false);
  if (pathname === '/api/run-now') {
    const result = actions.dispatchAvailableIssues(root);
    actions.updateManagedDispatch(root, result);
    return result;
  }
  if (pathname === '/api/reconcile') return actions.reconcileDependencies(root);
  if (pathname === '/api/config') {
    const current = actions.loadConfig(root);
    return actions.saveConfig(root, mergeRepositoryConfig(current, body));
  }
  if (pathname === '/api/start-issue') {
    return actions.dispatchSpecificCodingIssue(root, issueNumber(body), {
      branchAction: body.branchAction || 'keep',
    });
  }
  if (pathname === '/api/skip-issue') return actions.skipIssue(root, issueNumber(body));
  if (pathname === '/api/unskip-issue') return actions.unskipIssue(root, issueNumber(body));
  if (pathname === '/api/abandon-issue') {
    return actions.abandonAttempt(root, issueNumber(body), body.reason || 'Abandoned by user');
  }
  if (pathname === '/api/restart-issue') {
    return actions.queueCodingIssueRestart(root, issueNumber(body), {
      branchAction: body.branchAction || 'keep',
    });
  }
  return null;
}
