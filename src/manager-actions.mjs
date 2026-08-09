import { setClaimsEnabled } from './automation.mjs';
import {
  abandonAttempt,
  reconcileDependencies,
  skipIssue,
  unskipIssue,
  updateManagedDispatch,
} from './attempts.mjs';
import { appendControllerLog } from './controller-log.mjs';
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
  appendControllerLog,
};

function issueNumber(body) {
  const value = Number(body?.issueNumber);
  if (!Number.isInteger(value) || value <= 0) throw new Error('A positive issueNumber is required.');
  return value;
}

function actionName(pathname) {
  return String(pathname || '/api/action').replace(/^\/api\//, '').replaceAll('/', '-');
}

function actionDetails(pathname, body = {}) {
  const details = {};
  if (body.issueNumber !== undefined) details.issueNumber = Number(body.issueNumber) || body.issueNumber;
  if (body.branchAction) details.branchAction = body.branchAction;
  if (pathname === '/api/config') {
    details.baseBranch = body.baseBranch || null;
    details.pollIntervalSeconds = body.pollIntervalSeconds ?? null;
    details.maxActive = body.maxActive ?? null;
    details.configurationChanged = true;
  }
  return details;
}

function safeActionLog(actions, root, input) {
  if (typeof actions.appendControllerLog !== 'function') return null;
  try {
    return actions.appendControllerLog(root, {
      category: 'operator',
      source: 'operator',
      ...input,
    });
  } catch {
    return null;
  }
}

function runLoggedAction(root, pathname, body, actions, operation) {
  const action = actionName(pathname);
  const details = actionDetails(pathname, body);
  const startedAt = Date.now();
  safeActionLog(actions, root, {
    action,
    status: 'started',
    message: `Manager action ${action} started.`,
    details,
  });
  try {
    const result = operation();
    safeActionLog(actions, root, {
      action,
      status: 'success',
      message: `Manager action ${action} completed.`,
      details: { ...details, durationMs: Date.now() - startedAt },
    });
    return result;
  } catch (error) {
    safeActionLog(actions, root, {
      level: 'error',
      action,
      status: 'failed',
      message: `Manager action ${action} failed: ${error.message || error}`,
      details: { ...details, durationMs: Date.now() - startedAt, error },
    });
    throw error;
  }
}

export function managerRepositoryAction(root, pathname, body = {}, actions = defaultActions) {
  if (pathname === '/api/pause') return runLoggedAction(root, pathname, body, actions, () => actions.setClaimsEnabled(root, false));
  if (pathname === '/api/resume') return runLoggedAction(root, pathname, body, actions, () => actions.setClaimsEnabled(root, true));
  if (pathname === '/api/pr-review/pause') return runLoggedAction(root, pathname, body, actions, () => actions.setReviewQueuePaused(root, true));
  if (pathname === '/api/pr-review/resume') return runLoggedAction(root, pathname, body, actions, () => actions.setReviewQueuePaused(root, false));
  if (pathname === '/api/run-now') {
    return runLoggedAction(root, pathname, body, actions, () => {
      const result = actions.dispatchAvailableIssues(root);
      actions.updateManagedDispatch(root, result);
      return result;
    });
  }
  if (pathname === '/api/reconcile') return runLoggedAction(root, pathname, body, actions, () => actions.reconcileDependencies(root));
  if (pathname === '/api/config') {
    return runLoggedAction(root, pathname, body, actions, () => {
      const current = actions.loadConfig(root);
      return actions.saveConfig(root, mergeRepositoryConfig(current, body));
    });
  }
  if (pathname === '/api/start-issue') {
    return runLoggedAction(root, pathname, body, actions, () => actions.dispatchSpecificCodingIssue(root, issueNumber(body), {
      branchAction: body.branchAction || 'keep',
    }));
  }
  if (pathname === '/api/skip-issue') return runLoggedAction(root, pathname, body, actions, () => actions.skipIssue(root, issueNumber(body)));
  if (pathname === '/api/unskip-issue') return runLoggedAction(root, pathname, body, actions, () => actions.unskipIssue(root, issueNumber(body)));
  if (pathname === '/api/abandon-issue') {
    return runLoggedAction(root, pathname, body, actions, () => actions.abandonAttempt(root, issueNumber(body), body.reason || 'Abandoned by user'));
  }
  if (pathname === '/api/restart-issue') {
    return runLoggedAction(root, pathname, body, actions, () => actions.queueCodingIssueRestart(root, issueNumber(body), {
      branchAction: body.branchAction || 'keep',
    }));
  }
  return null;
}
