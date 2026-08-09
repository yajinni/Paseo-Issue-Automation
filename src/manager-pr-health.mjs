import { prHasExplicitIssueAssociation } from './pr-review-github.mjs';

const FAILED_CHECK_STATES = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'ERROR',
  'FAILURE',
  'STARTUP_FAILURE',
  'TIMED_OUT',
]);

const PENDING_CHECK_STATES = new Set([
  'EXPECTED',
  'IN_PROGRESS',
  'PENDING',
  'QUEUED',
  'REQUESTED',
  'WAITING',
]);

const REVIEW_IN_PROGRESS_STATES = new Set(['queued', 'submitting', 'awaiting_result']);
const FIX_IN_PROGRESS_STATES = new Set(['fix_queued', 'fixing', 'awaiting_new_sha']);

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function currentPrFromRun(run = {}) {
  const object = run.pullRequest && typeof run.pullRequest === 'object' ? run.pullRequest : {};
  const pr = run.pr && typeof run.pr === 'object' ? run.pr : {};
  const number = firstNumber(
    object.number,
    pr.number,
    run.pullRequestNumber,
    run.prNumber,
    run.review?.pullRequestNumber,
  );
  const url = firstString(object.url, pr.url, run.pullRequestUrl, run.prUrl, run.review?.pullRequestUrl);
  return number || url ? { number, url } : null;
}

function latestByTime(records = []) {
  return [...records].sort((left, right) => String(
    right?.updatedAt || right?.completedAt || right?.startedAt || right?.createdAt || '',
  ).localeCompare(String(
    left?.updatedAt || left?.completedAt || left?.startedAt || left?.createdAt || '',
  )))[0] || null;
}

function automationForRun(run = {}, store = null, prNumber = null) {
  if (!store || typeof store !== 'object') return { managed: null, reviewJob: null, fixJob: null };
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  const managed = latestByTime((store.managedPullRequests || [])
    .filter((entry) => Number(entry?.issueNumber) === issueNumber)
    .filter((entry) => !prNumber || Number(entry?.pullRequestNumber) === prNumber));
  if (!managed) return { managed: null, reviewJob: null, fixJob: null };
  const reviewJob = latestByTime((store.reviewJobs || [])
    .filter((job) => String(job?.managedPullRequestId || '') === String(managed.id)));
  const fixJob = latestByTime((store.fixJobs || [])
    .filter((job) => String(job?.managedPullRequestId || '') === String(managed.id)));
  return { managed, reviewJob, fixJob };
}

function checkState(check = {}) {
  return String(check.conclusion || check.state || check.status || '').trim().toUpperCase();
}

function checkName(check = {}) {
  return firstString(check.name, check.context, check.workflowName) || 'Required check';
}

export function summarizePrChecks(checks = []) {
  const failed = [];
  const pending = [];
  const passing = [];
  const unknown = [];
  for (const check of Array.isArray(checks) ? checks : []) {
    const state = checkState(check);
    const entry = { name: checkName(check), state: state || 'UNKNOWN' };
    if (FAILED_CHECK_STATES.has(state)) failed.push(entry);
    else if (PENDING_CHECK_STATES.has(state) || !state) pending.push(entry);
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) passing.push(entry);
    else unknown.push(entry);
  }
  return {
    total: failed.length + pending.length + passing.length + unknown.length,
    failedCount: failed.length,
    pendingCount: pending.length,
    passingCount: passing.length,
    unknownCount: unknown.length,
    failed,
    pending,
    passing,
    unknown,
  };
}

function problem(code, severity, title, message, stage, source = 'github') {
  return { code, severity, title, message, stage, source };
}

function pushProblem(problems, entry) {
  if (!problems.some((item) => item.code === entry.code)) problems.push(entry);
}

function sameSha(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function shortSha(value) {
  const sha = String(value || '').trim();
  return sha ? sha.slice(0, 12) : 'unknown';
}

function relevantReviewStage(run = {}) {
  const phase = String(run.phase || '');
  return /review|fix/.test(phase) ? 'reviewing' : 'draft-pr';
}

function healthPresentation(problems, snapshotAvailable) {
  const blockingCount = problems.filter((item) => item.severity === 'blocking').length;
  const attentionCount = problems.filter((item) => item.severity === 'attention').length;
  const waitingCount = problems.filter((item) => item.severity === 'waiting').length;
  const actionableCount = blockingCount + attentionCount;

  if (!snapshotAvailable) {
    return {
      status: 'unavailable',
      tone: 'warning',
      label: 'Unavailable',
      problemCount: actionableCount,
      blockingCount,
      attentionCount,
      waitingCount,
    };
  }
  if (blockingCount) {
    const label = attentionCount
      ? `${actionableCount} issues`
      : `${blockingCount} blocking issue${blockingCount === 1 ? '' : 's'}`;
    return { status: 'blocking', tone: 'danger', label, problemCount: actionableCount, blockingCount, attentionCount, waitingCount };
  }
  if (attentionCount) {
    return {
      status: 'attention',
      tone: 'warning',
      label: `${attentionCount} issue${attentionCount === 1 ? '' : 's'}`,
      problemCount: attentionCount,
      blockingCount,
      attentionCount,
      waitingCount,
    };
  }
  if (waitingCount) {
    return { status: 'waiting', tone: 'warning', label: 'Waiting', problemCount: 0, blockingCount, attentionCount, waitingCount };
  }
  return { status: 'healthy', tone: 'success', label: 'Healthy', problemCount: 0, blockingCount: 0, attentionCount: 0, waitingCount: 0 };
}

export function classifyPrHealth({
  run = {},
  pullRequest = currentPrFromRun(run),
  snapshot = null,
  snapshotError = null,
  managed = null,
  reviewJob = null,
  fixJob = null,
} = {}) {
  if (!pullRequest?.number) return null;
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  const problems = [];
  const snapshotAvailable = Boolean(snapshot && typeof snapshot === 'object');
  const currentHeadSha = firstString(snapshot?.headRefOid, managed?.currentHeadSha, run.currentHeadSha);
  const reviewStage = relevantReviewStage(run);

  if (!snapshotAvailable) {
    pushProblem(problems, problem(
      'github-pr-unavailable',
      'attention',
      'GitHub PR state unavailable',
      snapshotError || `Paseo could not read current GitHub state for PR #${pullRequest.number}.`,
      reviewStage,
      'github',
    ));
  }

  const checks = summarizePrChecks(snapshot?.statusCheckRollup || []);
  if (snapshotAvailable) {
    const state = String(snapshot.state || '').toUpperCase();
    const mergeable = String(snapshot.mergeable || '').toUpperCase();
    const mergeState = String(snapshot.mergeStateStatus || '').toUpperCase();
    const reviewDecision = String(snapshot.reviewDecision || '').toUpperCase();

    if (state === 'CLOSED' && !snapshot.mergedAt) {
      pushProblem(problems, problem(
        'closed-unmerged',
        'blocking',
        'PR closed without merge',
        `PR #${pullRequest.number} is closed and was not merged.`,
        reviewStage,
      ));
    }
    if (snapshot.isDraft === true && !snapshot.mergedAt) {
      pushProblem(problems, problem(
        'draft-pr',
        'waiting',
        'Draft PR is not ready for review',
        `PR #${pullRequest.number} is still a draft.`,
        'draft-pr',
      ));
    }
    if (mergeable === 'CONFLICTING' || mergeState === 'DIRTY') {
      pushProblem(problems, problem(
        'merge-conflict',
        'blocking',
        'Merge conflict detected',
        `PR #${pullRequest.number} conflicts with ${snapshot.baseRefName || 'the base branch'}.`,
        'reviewing',
      ));
    } else if (mergeState === 'BEHIND') {
      pushProblem(problems, problem(
        'branch-behind-base',
        'waiting',
        'PR branch is behind the base branch',
        `${snapshot.headRefName || 'The PR branch'} needs the latest ${snapshot.baseRefName || 'base branch'} before merge.`,
        'reviewing',
      ));
    }
    if (checks.failedCount) {
      pushProblem(problems, problem(
        'checks-failed',
        'blocking',
        'Required checks failed',
        checks.failed.map((entry) => `${entry.name}: ${entry.state}`).join(' · '),
        'reviewing',
      ));
    } else if (checks.pendingCount) {
      pushProblem(problems, problem(
        'checks-pending',
        'waiting',
        'Waiting for required checks',
        `${checks.pendingCount} check${checks.pendingCount === 1 ? ' is' : 's are'} still pending.`,
        'reviewing',
      ));
    }
    if (reviewDecision === 'CHANGES_REQUESTED') {
      pushProblem(problems, problem(
        'github-changes-requested',
        'blocking',
        'GitHub review requested changes',
        'GitHub reports a changes-requested review decision for the current PR.',
        'reviewing',
      ));
    } else if (reviewDecision === 'REVIEW_REQUIRED') {
      pushProblem(problems, problem(
        'github-review-required',
        'waiting',
        'Waiting for required GitHub review',
        'Repository policy still requires a GitHub review before merge.',
        'reviewing',
      ));
    }
    if (mergeState === 'BLOCKED' && !checks.failedCount && !checks.pendingCount && reviewDecision !== 'REVIEW_REQUIRED') {
      pushProblem(problems, problem(
        'merge-blocked',
        'waiting',
        'Merge is blocked by repository requirements',
        'GitHub reports the PR as blocked even though no specific failed check is currently identified.',
        'reviewing',
      ));
    }

    if (issueNumber && !run.issueClosureVerifiedAt && !run.completedAt
        && !prHasExplicitIssueAssociation(snapshot, issueNumber)) {
      pushProblem(problems, problem(
        'issue-association-missing',
        'attention',
        'Issue-closing association is missing',
        `PR #${pullRequest.number} does not explicitly close issue #${issueNumber}; post-merge completion may require intervention.`,
        'draft-pr',
      ));
    }
  }

  if (managed?.reviewState === 'changes_requested') {
    pushProblem(problems, problem(
      'paseo-changes-requested',
      'blocking',
      'Paseo review requested changes',
      'The current managed PR has blocking Paseo review findings.',
      'reviewing',
      'paseo',
    ));
  }
  if (managed?.reviewState === 'failed' || reviewJob?.state === 'failed') {
    pushProblem(problems, problem(
      'review-automation-failed',
      'attention',
      'PR review automation failed',
      firstString(reviewJob?.lastError, managed?.lastError) || 'The current PR review job requires operator attention.',
      'reviewing',
      'paseo',
    ));
  }
  if (fixJob && ['failed', 'interrupted'].includes(String(fixJob.state || ''))) {
    pushProblem(problems, problem(
      'fix-automation-failed',
      'attention',
      'PR fix automation stopped',
      firstString(fixJob.lastError) || `The current fix job is ${fixJob.state}.`,
      'reviewing',
      'paseo',
    ));
  } else if (fixJob && ['fix_queued', 'fixing'].includes(String(fixJob.state || ''))) {
    pushProblem(problems, problem(
      'fix-in-progress',
      'waiting',
      'Requested changes are being fixed',
      'Paseo is working on the current review findings.',
      'reviewing',
      'paseo',
    ));
  }

  const approvedHeadSha = firstString(run.approvedHeadSha, run.approvedCommit);
  if (run.reviewApproved === true && approvedHeadSha && currentHeadSha && !sameSha(approvedHeadSha, currentHeadSha)) {
    pushProblem(problems, problem(
      'review-approval-stale',
      'blocking',
      'Review approval is stale',
      `Approval is bound to ${shortSha(approvedHeadSha)}, but the current PR head is ${shortSha(currentHeadSha)}.`,
      'reviewing',
      'paseo',
    ));
  }

  const validationHeadSha = firstString(run.validationHeadSha);
  if (run.validationApproved === true && validationHeadSha && currentHeadSha && !sameSha(validationHeadSha, currentHeadSha)) {
    pushProblem(problems, problem(
      'validation-stale',
      'blocking',
      'Validation evidence is stale',
      `Validation is bound to ${shortSha(validationHeadSha)}, but the current PR head is ${shortSha(currentHeadSha)}.`,
      'reviewing',
      'paseo',
    ));
  }

  const lastCompletedReviewSha = firstString(managed?.lastCompletedReviewSha);
  if (!run.reviewApproved && lastCompletedReviewSha && currentHeadSha && !sameSha(lastCompletedReviewSha, currentHeadSha)) {
    const inProgress = REVIEW_IN_PROGRESS_STATES.has(String(managed?.reviewState || ''));
    pushProblem(problems, problem(
      'reviewed-head-stale',
      inProgress ? 'waiting' : 'blocking',
      'Reviewed head is stale',
      inProgress
        ? `The previous review covered ${shortSha(lastCompletedReviewSha)}; ${shortSha(currentHeadSha)} is queued or running for re-review.`
        : `The latest completed review covered ${shortSha(lastCompletedReviewSha)}, not current head ${shortSha(currentHeadSha)}.`,
      'reviewing',
      'paseo',
    ));
  }

  if (managed?.reviewEvidenceMissing === true) {
    pushProblem(problems, problem(
      'review-evidence-missing',
      'blocking',
      'Approved review evidence is missing',
      'Paseo cannot prove that the exact current or merged head has the required approved review evidence.',
      'reviewing',
      'paseo',
    ));
  }
  if ((managed?.issueClosurePending === true || managed?.lifecycleCompletionPending === true)
      && (snapshot?.mergedAt || managed?.reviewState === 'merged')) {
    pushProblem(problems, problem(
      'issue-closure-pending',
      'attention',
      'Issue closure verification is pending',
      `PR #${pullRequest.number} merged, but Paseo has not yet completed issue-closure reconciliation.`,
      'closure-verified',
      'paseo',
    ));
  }

  if (managed?.lastError && !problems.some((item) => item.source === 'paseo' && item.severity !== 'waiting')) {
    pushProblem(problems, problem(
      'pr-automation-error',
      'attention',
      'PR automation reported an error',
      String(managed.lastError),
      reviewStage,
      'paseo',
    ));
  }

  const presentation = healthPresentation(problems, snapshotAvailable);
  return {
    ...presentation,
    currentPr: {
      number: firstNumber(snapshot?.number, pullRequest.number),
      url: firstString(snapshot?.url, pullRequest.url),
      state: firstString(snapshot?.state),
      isDraft: snapshot?.isDraft === true,
      headSha: currentHeadSha,
      headRefName: firstString(snapshot?.headRefName, managed?.branchName, run.branch),
      baseRefName: firstString(snapshot?.baseRefName),
      mergedAt: firstString(snapshot?.mergedAt, run.mergedAt),
      closedAt: firstString(snapshot?.closedAt),
      mergeable: firstString(snapshot?.mergeable),
      mergeStateStatus: firstString(snapshot?.mergeStateStatus),
      reviewDecision: firstString(snapshot?.reviewDecision),
      issueAssociation: snapshotAvailable && issueNumber
        ? prHasExplicitIssueAssociation(snapshot, issueNumber)
        : null,
    },
    snapshotAvailable,
    snapshotError: snapshotError ? String(snapshotError) : null,
    checks,
    problems,
  };
}

export function managerPrHealthSummary(runs = [], store = null, { loadSnapshot = null } = {}) {
  const byIssue = {};
  const snapshotCache = new Map();
  const counts = {
    withPullRequest: 0,
    healthy: 0,
    waiting: 0,
    attention: 0,
    blocking: 0,
    unavailable: 0,
    problems: 0,
  };

  for (const run of runs || []) {
    if (!run) continue;
    const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
    const pullRequest = currentPrFromRun(run);
    if (!issueNumber || !pullRequest?.number) continue;
    counts.withPullRequest += 1;

    let cached = snapshotCache.get(pullRequest.number);
    if (!cached) {
      cached = { snapshot: null, error: null };
      if (typeof loadSnapshot === 'function') {
        try {
          cached.snapshot = loadSnapshot(pullRequest.number) || null;
        } catch (error) {
          cached.error = error instanceof Error ? error.message : String(error);
        }
      } else {
        cached.error = 'No PR snapshot loader is configured.';
      }
      snapshotCache.set(pullRequest.number, cached);
    }

    const automation = automationForRun(run, store, pullRequest.number);
    const health = classifyPrHealth({
      run,
      pullRequest,
      snapshot: cached.snapshot,
      snapshotError: cached.error,
      ...automation,
    });
    byIssue[String(issueNumber)] = health;
    counts[health.status] = (counts[health.status] || 0) + 1;
    counts.problems += health.problemCount;
  }

  return { byIssue, counts };
}
