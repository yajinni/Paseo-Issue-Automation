import { markHumanReview } from './automation.mjs';
import { managedPrSnapshot } from './pr-review-github.mjs';
import { loadConfig, loadRun, saveRun } from './state.mjs';
import { run } from './process.mjs';

const FAILED_CHECK_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']);
const PENDING_CHECK_STATES = new Set(['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING', 'UNKNOWN']);

function checkState(check) {
  return String(check?.conclusion || check?.state || check?.status || 'UNKNOWN').toUpperCase();
}

export function summarizeReviewGateChecks(checks = []) {
  const normalized = (Array.isArray(checks) ? checks : []).map((check) => ({
    name: check.name || check.context || check.workflowName || 'check',
    state: checkState(check),
  }));
  const failed = normalized.filter((check) => FAILED_CHECK_STATES.has(check.state));
  const pending = normalized.filter((check) => PENDING_CHECK_STATES.has(check.state));
  return {
    state: failed.length ? 'failed' : pending.length ? 'pending' : 'passed',
    failed,
    pending,
    checks: normalized,
  };
}

function latestValidationForCommit(state, commit) {
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary' && event.result === 'PASS' && event.commit === commit) || null;
}

export function evaluateApprovedReviewGate(root, managed, reviewJob, pr, {
  runner = run,
  config = loadConfig(root),
  runState = loadRun(root, managed.issueNumber),
} = {}) {
  if (!pr || String(pr.state || '').toUpperCase() !== 'OPEN') {
    return { ok: false, repair: false, reason: 'The reviewed pull request is no longer open.' };
  }
  const currentHead = String(pr.headRefOid || '').toLowerCase();
  const reviewedHead = String(reviewJob.headSha || '').toLowerCase();
  if (!currentHead || currentHead !== reviewedHead || managed.currentHeadSha !== reviewedHead) {
    return { ok: false, stale: true, reason: 'The pull-request head changed after the reviewed commit.' };
  }
  if (pr.baseRefName !== config.baseBranch) {
    return { ok: false, repair: false, reason: `The pull request targets ${pr.baseRefName || 'an unknown branch'}, not ${config.baseBranch}.` };
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    return { ok: false, repair: true, reason: `GitHub reports merge conflicts with ${config.baseBranch}.` };
  }
  const checks = summarizeReviewGateChecks(pr.statusCheckRollup);
  if (checks.state === 'pending') {
    return {
      ok: false,
      waiting: true,
      reason: `Waiting for GitHub checks on ${reviewedHead}: ${checks.pending.map((check) => `${check.name}: ${check.state}`).join(', ')}`,
      checks,
    };
  }
  if (checks.state === 'failed') {
    return {
      ok: false,
      repair: true,
      reason: `GitHub checks failed on ${reviewedHead}:\n${checks.failed.map((check) => `${check.name}: ${check.state}`).join('\n')}`,
      checks,
    };
  }
  if (!latestValidationForCommit(runState, reviewedHead)) {
    return {
      ok: false,
      repair: true,
      reason: `No passing validation-summary event exists for the reviewed commit ${reviewedHead}.`,
    };
  }

  const fetch = runner('git', ['fetch', '--prune', 'origin', config.baseBranch, managed.branchName], {
    cwd: root,
    allowFailure: true,
  });
  if (!fetch.ok) {
    return { ok: false, waiting: true, reason: fetch.stderr || fetch.stdout || `Could not refresh ${config.baseBranch} and ${managed.branchName}.` };
  }
  const baseRef = `refs/remotes/origin/${config.baseBranch}`;
  const branchRef = `refs/remotes/origin/${managed.branchName}`;
  const fresh = runner('git', ['merge-base', '--is-ancestor', baseRef, branchRef], {
    cwd: root,
    allowFailure: true,
  });
  if (!fresh.ok) {
    return { ok: false, repair: true, reason: `The reviewed branch does not contain the latest ${config.baseBranch}.` };
  }
  return { ok: true, commit: reviewedHead, checks };
}

export function recordApprovedBrowserReview(root, managed, reviewJob, {
  findings = 'Browser Reviewer approved this exact validated commit.',
} = {}) {
  const state = loadRun(root, managed.issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${managed.issueNumber}.`);
  const existing = (state.events || []).some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.commit === reviewJob.headSha
    && event.source === 'browser-review'
    && event.reviewRequestId === reviewJob.reviewRequestId);
  if (existing) return state;
  const at = new Date().toISOString();
  return saveRun(root, managed.issueNumber, {
    ...state,
    approvedCommit: reviewJob.headSha,
    events: [...(state.events || []), {
      event: 'review',
      result: 'APPROVED',
      commit: reviewJob.headSha,
      details: String(findings || ''),
      source: 'browser-review',
      reviewRequestId: reviewJob.reviewRequestId,
      at,
    }],
    updatedAt: at,
    heartbeatAt: at,
  });
}

export function finalizeApprovedBrowserReview(root, managed, reviewJob, {
  findings = 'Browser Reviewer approved this exact validated commit.',
  pr = null,
  gate = null,
} = {}) {
  const currentPr = pr || managedPrSnapshot(root, managed.pullRequestNumber);
  const evaluated = gate || evaluateApprovedReviewGate(root, managed, reviewJob, currentPr);
  if (!evaluated.ok) {
    const error = new Error(evaluated.reason || 'The browser-review completion gate did not pass.');
    error.gate = evaluated;
    throw error;
  }
  recordApprovedBrowserReview(root, managed, reviewJob, { findings });
  return markHumanReview(root, managed.issueNumber, managed.pullRequestNumber);
}
