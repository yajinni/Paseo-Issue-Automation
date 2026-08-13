import { recordEvent } from './automation.mjs';
import { finalizeApprovedPullRequest } from './approved-pr-finalization.mjs';
import { managedPrSnapshot, managerPrHealthSnapshot } from './pr-review-github.mjs';
import { loadConfig, loadRun, saveRun } from './state.mjs';
import { run } from './process.mjs';

const FAILED_CHECK_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']);
const PENDING_CHECK_STATES = new Set(['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING', 'UNKNOWN']);
const IMPORTED_FINALIZATION_PREFIX = 'approved-finalization:';

function checkState(check) {
  return String(check?.conclusion || check?.state || check?.status || 'UNKNOWN').toUpperCase();
}

function importedFinalizationEvidence(reviewJob) {
  return String(reviewJob?.reviewRequestId || '').startsWith(IMPORTED_FINALIZATION_PREFIX);
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

function recoverMissingControllerValidation(root, managed, pr, reviewedHead, {
  runner = run,
  recordValidation = recordEvent,
} = {}) {
  const worktreePath = String(managed?.worktreePath || '').trim();
  if (!worktreePath) {
    return { ok: false, reason: 'The managed worktree path is unavailable.' };
  }
  const prBranch = String(pr?.headRefName || '').trim();
  if (prBranch && prBranch !== String(managed?.branchName || '').trim()) {
    return { ok: false, reason: `PR head branch ${prBranch} does not match managed branch ${managed?.branchName || '(missing)'}.` };
  }

  const headResult = runner('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, allowFailure: true });
  if (!headResult?.ok) {
    return { ok: false, reason: headResult?.stderr || headResult?.stdout || 'Could not read the managed worktree HEAD.' };
  }
  const localHead = String(headResult.stdout || '').trim().toLowerCase();
  if (!localHead || localHead !== reviewedHead) {
    return { ok: false, reason: `Managed worktree HEAD ${localHead || '(missing)'} does not match reviewed PR head ${reviewedHead}.` };
  }

  const status = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: worktreePath, allowFailure: true });
  if (!status?.ok) {
    return { ok: false, reason: status?.stderr || status?.stdout || 'Could not inspect the managed worktree status.' };
  }
  const changes = String(status.stdout || '').trim();
  if (changes) {
    return { ok: false, reason: `The managed worktree is not clean:\n${changes}` };
  }

  let saved;
  try {
    saved = recordValidation(root, managed.issueNumber, {
      event: 'validation-summary',
      result: 'PASS',
      commit: reviewedHead,
      details: 'Deterministic approval gate recovered the controller-owned exact-head validation handoff after GitHub CI and current-base checks passed and the managed worktree was clean with local HEAD exactly matching the open reviewed PR head.',
    });
  } catch (error) {
    return { ok: false, reason: `Could not record controller validation: ${error instanceof Error ? error.message : String(error)}` };
  }
  const validation = latestValidationForCommit(saved, reviewedHead);
  if (!validation) {
    return { ok: false, reason: `Controller validation was not persisted for exact head ${reviewedHead}.` };
  }
  return { ok: true, validation };
}

export function evaluateApprovedReviewGate(root, managed, reviewJob, pr, {
  runner = run,
  config = loadConfig(root),
  runState = loadRun(root, managed.issueNumber),
  recordValidation = recordEvent,
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

  const baseRef = `refs/remotes/origin/${config.baseBranch}`;
  const branchRef = `refs/remotes/origin/${managed.branchName}`;
  const fetch = runner('git', [
    'fetch',
    '--prune',
    'origin',
    `+refs/heads/${config.baseBranch}:${baseRef}`,
    `+refs/heads/${managed.branchName}:${branchRef}`,
  ], {
    cwd: root,
    allowFailure: true,
  });
  if (!fetch.ok) {
    return { ok: false, waiting: true, reason: fetch.stderr || fetch.stdout || `Could not refresh ${config.baseBranch} and ${managed.branchName}.` };
  }
  const fresh = runner('git', ['merge-base', '--is-ancestor', baseRef, branchRef], {
    cwd: root,
    allowFailure: true,
  });
  if (!fresh.ok) {
    return { ok: false, repair: true, reason: `The reviewed branch does not contain the latest ${config.baseBranch}.` };
  }

  let validation = latestValidationForCommit(runState, reviewedHead);
  let validationRecovered = false;
  if (!validation) {
    const recovered = recoverMissingControllerValidation(root, managed, pr, reviewedHead, {
      runner,
      recordValidation,
    });
    if (!recovered.ok) {
      return {
        ok: false,
        repair: true,
        validationMissing: true,
        reason: `No passing validation-summary event exists for the reviewed commit ${reviewedHead}. Controller recovery failed: ${recovered.reason}`,
      };
    }
    validation = recovered.validation;
    validationRecovered = true;
  }

  return { ok: true, commit: reviewedHead, checks, validation, validationRecovered };
}

export function recordApprovedBrowserReview(root, managed, reviewJob, {
  findings = 'Browser Reviewer approved this exact validated commit.',
} = {}) {
  const state = loadRun(root, managed.issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${managed.issueNumber}.`);
  if (importedFinalizationEvidence(reviewJob)) return state;
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
  if (importedFinalizationEvidence(reviewJob)) {
    return {
      mode: 'managed-finalization',
      unchanged: true,
      state: loadRun(root, managed.issueNumber),
    };
  }
  const currentPr = pr || managedPrSnapshot(root, managed.pullRequestNumber);
  const evaluated = gate || evaluateApprovedReviewGate(root, managed, reviewJob, currentPr);
  if (!evaluated.ok) {
    const error = new Error(evaluated.reason || 'The browser-review completion gate did not pass.');
    error.gate = evaluated;
    throw error;
  }
  const state = recordApprovedBrowserReview(root, managed, reviewJob, { findings });
  const health = managerPrHealthSnapshot(root, managed.pullRequestNumber);
  if (!health) throw new Error(`Could not read PR #${managed.pullRequestNumber} for deterministic finalization.`);
  return finalizeApprovedPullRequest(root, {
    repository: managed.repository,
    issueNumber: managed.issueNumber,
    issueUrl: managed.issueUrl,
    pullRequest: health,
    state,
    findings: [],
    unresolvedFindings: false,
    approvalSource: 'browser-review',
    paseoOwned: String(health.headRefName || '') === String(managed.branchName || '')
      && String(health.headRefOid || '').toLowerCase() === String(reviewJob.headSha || '').toLowerCase(),
  });
}
