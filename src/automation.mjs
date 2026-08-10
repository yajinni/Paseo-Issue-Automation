import { appendControllerLog } from './controller-log.mjs';
import {
  sectionContent,
  validateIssueBody,
} from './issue-contract.mjs';
import { issueFailureRetryDecision } from './issue-failure-policy.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { run, runJson } from './process.mjs';
import { LABELS, loadConfig, loadRun, loadRuntime, saveRun, saveRuntime } from './state.mjs';

export { sectionContent, validateIssueBody };

function safeIssueLog(root, input) {
  try { return appendControllerLog(root, { category: 'issues', source: 'automation', ...input }); }
  catch (error) {
    console.error(JSON.stringify({ subsystem: 'controller-log', error: error.message }));
    return null;
  }
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

function editLabels(root, issueNumber, { add = [], remove = [] }) {
  const args = ['issue', 'edit', String(issueNumber)];
  for (const label of add) args.push('--add-label', label);
  for (const label of remove) args.push('--remove-label', label);
  run('gh', args, { cwd: root });
}

function notifyTerminalState(root, issueNumber, { add = [], remove = [], comment }) {
  const failures = [];
  try {
    editLabels(root, issueNumber, { add, remove });
  } catch (error) {
    failures.push(`labels: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    run('gh', ['issue', 'comment', String(issueNumber), '--body', comment], { cwd: root });
  } catch (error) {
    failures.push(`comment: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (failures.length) {
    safeIssueLog(root, {
      level: 'warn',
      action: 'issue-terminal-notification-failed',
      status: 'warning',
      message: `Issue #${Number(issueNumber)} reached terminal local state, but one or more GitHub notifications failed.`,
      details: { issueNumber: Number(issueNumber), failures },
    });
  }
}

function issueList(root, label) {
  return runJson('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,body,labels,state,url,createdAt',
  ], { cwd: root }) || [];
}

export function setClaimsEnabled(root, enabled) {
  const runtime = saveRuntime(root, { ...loadRuntime(root), claimsEnabled: enabled });
  safeIssueLog(root, {
    action: enabled ? 'resume-issues-processing' : 'stop-issues-processing',
    status: 'success',
    message: enabled ? 'Issues Processing was resumed.' : 'Issues Processing was stopped.',
    details: { claimsEnabled: runtime.claimsEnabled },
  });
  return runtime;
}

function requireRun(root, issueNumber) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  return state;
}

export function recordEvent(root, issueNumber, event) {
  const state = requireRun(root, issueNumber);
  const stagedReviewEvidence = ['harness-review-compat', 'manual-review'].includes(event.source);
  if (event.event === 'review' && !stagedReviewEvidence) {
    const completedRounds = (state.events || []).filter((item) => item.event === 'review').length;
    const maximum = loadConfig(root).maxReviewRounds;
    if (completedRounds >= maximum) throw new Error(`Maximum review rounds (${maximum}) reached.`);
  }
  const recorded = { ...event, at: new Date().toISOString() };
  const next = {
    ...state,
    events: [...(state.events || []), recorded],
    updatedAt: new Date().toISOString(),
  };
  const saved = saveRun(root, issueNumber, next);
  safeIssueLog(root, {
    level: String(event.result || '').toUpperCase() === 'FAIL' ? 'error' : 'info',
    action: `issue-${String(event.event || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    status: String(event.result || '').toUpperCase() === 'FAIL' ? 'failed' : 'success',
    message: `Issue #${Number(issueNumber)} recorded ${event.event || 'an automation event'}${event.result ? `: ${event.result}` : ''}.`,
    details: {
      issueNumber: Number(issueNumber),
      event: recorded,
      phase: saved.phase || null,
      branch: saved.branch || saved.branchName || null,
      pullRequestNumber: saved.prNumber || saved.pullRequestNumber || null,
    },
  });
  return saved;
}

export function heartbeat(root, issueNumber, phase) {
  const state = requireRun(root, issueNumber);
  const saved = saveRun(root, issueNumber, {
    ...state,
    phase: String(phase || state.phase || 'running'),
    heartbeatAt: new Date().toISOString(),
  });
  safeIssueLog(root, {
    level: 'debug',
    action: 'issue-heartbeat',
    status: 'success',
    message: `Issue #${Number(issueNumber)} heartbeat: ${saved.phase}.`,
    details: { issueNumber: Number(issueNumber), phase: saved.phase, heartbeatAt: saved.heartbeatAt },
  });
  return saved;
}

function prChecksPass(root, prNumber, commit) {
  const pr = runJson('gh', [
    'pr', 'view', String(prNumber),
    '--json', 'number,isDraft,headRefOid,baseRefName,statusCheckRollup,url',
  ], { cwd: root });
  if (!pr || pr.headRefOid !== commit) throw new Error('The PR head does not match the approved commit.');
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failed = checks.filter((check) => {
    const state = String(check.conclusion || check.state || check.status || '').toUpperCase();
    return ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state);
  });
  const pending = checks.filter((check) => {
    const state = String(check.conclusion || check.state || check.status || '').toUpperCase();
    return !state || ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING'].includes(state);
  });
  if (failed.length) throw new Error('One or more GitHub checks failed on the approved commit.');
  if (pending.length) throw new Error('One or more GitHub checks are still pending on the approved commit.');
  return pr;
}

export function markHumanReview(root, issueNumber, prNumber) {
  const config = loadConfig(root);
  const state = requireRun(root, issueNumber);
  const validations = (state.events || []).filter((event) => event.event === 'validation-summary' && event.result === 'PASS');
  const reviews = (state.events || []).filter((event) => event.event === 'review' && event.result === 'APPROVED');
  const validation = validations.at(-1);
  const review = reviews.at(-1);
  if (!validation?.commit || validation.commit !== review?.commit) {
    throw new Error('Human review requires matching PASS validation and APPROVED review events for one exact commit.');
  }
  const pr = prChecksPass(root, prNumber, validation.commit);
  if (pr.baseRefName !== config.baseBranch) throw new Error(`PR must target ${config.baseBranch}.`);

  editLabels(root, issueNumber, {
    add: [PASEO_LABELS.reviewQueued],
    remove: [PASEO_LABELS.coding, PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.failed, PASEO_LABELS.needsAttention],
  });
  run('gh', ['issue', 'comment', String(issueNumber), '--body', `NEEDS HUMAN REVIEW FOR PR #${prNumber}`], {
    cwd: root,
  });
  const saved = saveRun(root, issueNumber, {
    ...state,
    status: LABELS.humanReview,
    phase: 'human-review',
    prNumber: Number(prNumber),
    approvedCommit: validation.commit,
    completedAt: new Date().toISOString(),
  });
  safeIssueLog(root, {
    action: 'issue-human-review',
    status: 'success',
    message: `Issue #${Number(issueNumber)} is ready for human review on PR #${Number(prNumber)}.`,
    details: {
      issueNumber: Number(issueNumber),
      pullRequestNumber: Number(prNumber),
      approvedCommit: validation.commit,
    },
  });
  return saved;
}

export function terminalState(root, issueNumber, status, reason) {
  const state = requireRun(root, issueNumber);
  if (status === 'failed') {
    const retry = issueFailureRetryDecision({ message: String(reason || '') }, loadConfig(root), state);
    if (retry.transient && retry.retry) {
      const at = new Date().toISOString();
      const saved = saveRun(root, issueNumber, {
        ...state,
        status: LABELS.running,
        phase: 'retry-pending',
        reason: retry.reason,
        failureType: retry.type,
        temporaryFailureCount: retry.attempt,
        temporaryFailureMaximum: retry.maximum,
        controllerPid: null,
        completedAt: null,
        updatedAt: at,
        activity: [
          ...(state.activity || []),
          {
            type: 'temporary-failure-retry-scheduled',
            at,
            details: `${retry.type} failure; retry ${retry.attempt}/${retry.maximum} will run on a later scheduler turn. ${retry.reason}`,
          },
        ],
      });
      safeIssueLog(root, {
        level: 'warn',
        action: 'issue-temporary-failure-retry-scheduled',
        status: 'waiting',
        message: `Issue #${Number(issueNumber)} scheduled temporary-failure retry ${retry.attempt}/${retry.maximum}.`,
        details: { issueNumber: Number(issueNumber), failureType: retry.type, reason: retry.reason },
      });
      return saved;
    }
    if (retry.transient && retry.exhausted) {
      const exhaustedReason = `Temporary ${retry.type} failure exhausted ${retry.maximum} configured retries: ${retry.reason}`;
      const at = new Date().toISOString();
      const saved = saveRun(root, issueNumber, {
        ...state,
        status: PASEO_LABELS.failed,
        phase: 'failed',
        reason: exhaustedReason,
        failureType: retry.type,
        temporaryFailureCount: retry.attempt,
        temporaryFailureMaximum: retry.maximum,
        controllerPid: null,
        completedAt: at,
        updatedAt: at,
        activity: [
          ...(state.activity || []),
          { type: 'temporary-failure-retries-exhausted', at, details: exhaustedReason },
        ],
      });
      notifyTerminalState(root, issueNumber, {
        add: [PASEO_LABELS.failed, PASEO_LABELS.needsAttention],
        remove: [PASEO_LABELS.coding, PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.failed, PASEO_LABELS.reviewQueued],
        comment: `Automation failed and needs attention: ${exhaustedReason}`,
      });
      safeIssueLog(root, {
        level: 'error',
        action: 'issue-temporary-failure-retries-exhausted',
        status: 'failed',
        message: `Issue #${Number(issueNumber)} exhausted temporary-failure retries and needs attention.`,
        details: { issueNumber: Number(issueNumber), failureType: retry.type, reason: exhaustedReason },
      });
      return saved;
    }
  }

  const label = status === 'blocked' ? LABELS.blocked : LABELS.failed;
  const at = new Date().toISOString();
  const saved = saveRun(root, issueNumber, {
    ...state,
    status: label,
    phase: status,
    reason,
    controllerPid: null,
    completedAt: at,
    updatedAt: at,
  });
  notifyTerminalState(root, issueNumber, {
    add: [status === 'blocked' ? PASEO_LABELS.needsAttention : PASEO_LABELS.failed],
    remove: [PASEO_LABELS.coding, PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.reviewQueued, PASEO_LABELS.changesRequested, PASEO_LABELS.fixing, PASEO_LABELS.reviewing],
    comment: `Automation ${status}: ${reason}`,
  });
  safeIssueLog(root, {
    level: status === 'failed' ? 'error' : 'warn',
    action: status === 'blocked' ? 'issue-blocked' : 'issue-failed',
    status: status === 'blocked' ? 'waiting' : 'failed',
    message: `Issue #${Number(issueNumber)} was ${status}: ${reason}`,
    details: { issueNumber: Number(issueNumber), status, reason },
  });
  return saved;
}

export function automationStatus(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const counts = {};
  for (const [name, label] of Object.entries(LABELS)) counts[name] = issueList(root, label).length;
  return { config, runtime, counts };
}
