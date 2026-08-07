import { run as defaultRun, runJson as defaultRunJson } from './process.mjs';

export const AUTO_MERGE_WORKFLOWS = Object.freeze([
  'full-immediate',
  'quick-web-chatgpt',
]);

function text(value) {
  return String(value || '').trim();
}

function blockingFindings(value) {
  return (Array.isArray(value) ? value : []).filter((finding) => finding && finding.severity === 'blocking');
}

export function codingPullRequestClosingLine(issueNumber) {
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error('A valid issue number is required for the coding pull request.');
  return `Closes #${number}`;
}

export function ensureCodingPullRequestBody(body, issueNumber) {
  const line = codingPullRequestClosingLine(issueNumber);
  const current = String(body || '').trim();
  const closingPattern = new RegExp(`(^|\\n)\\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${Number(issueNumber)}(?:\\s|$)`, 'i');
  if (closingPattern.test(current)) return current;
  return current ? `${current}\n\n${line}` : line;
}

export function approvedPullRequestMergeEligibility({
  config = {},
  pullRequest = {},
  review = {},
  validation = {},
  currentBaseBranch = '',
  paseoOwned = false,
} = {}) {
  const reasons = [];
  const workflow = text(config.review?.workflow);
  const autoMergeApproved = config.review?.autoMergeApproved === true;
  const headSha = text(pullRequest.headSha);
  const approvedHeadSha = text(review.approvedHeadSha);
  const validationHeadSha = text(validation.headSha);
  const configuredBase = text(config.baseBranch);
  const prBase = text(pullRequest.baseBranch);
  const observedBase = text(currentBaseBranch || prBase);

  if (!AUTO_MERGE_WORKFLOWS.includes(workflow)) reasons.push('workflow-not-eligible');
  if (!autoMergeApproved) reasons.push('auto-merge-disabled');
  if (!paseoOwned) reasons.push('unrecognized-paseo-ownership');
  if (!headSha) reasons.push('missing-head-sha');
  if (review.approved !== true || !approvedHeadSha || approvedHeadSha !== headSha) reasons.push('exact-head-not-approved');
  if (validation.passed !== true || !validationHeadSha || validationHeadSha !== headSha) reasons.push('exact-head-validation-not-passed');
  if (blockingFindings(review.findings).length > 0 || review.unresolvedFindings === true) reasons.push('unresolved-review-findings');
  if (pullRequest.checksPassed !== true) reasons.push('required-checks-not-passed');
  if (!configuredBase || !prBase || configuredBase !== prBase || observedBase !== configuredBase) reasons.push('base-target-not-current');
  if (pullRequest.state && pullRequest.state !== 'open') reasons.push('pull-request-not-open');
  if (pullRequest.mergeable === false || pullRequest.conflicted === true) reasons.push('pull-request-not-mergeable');

  return {
    eligible: reasons.length === 0,
    reasons,
    workflow,
    headSha,
    baseBranch: configuredBase,
    issueNumber: Number(pullRequest.issueNumber) || null,
    pullRequestNumber: Number(pullRequest.number) || null,
  };
}

export function requestApprovedPullRequestAutoMerge(root, context = {}, options = {}) {
  const eligibility = approvedPullRequestMergeEligibility(context);
  if (!eligibility.eligible) return { requested: false, enabled: false, eligibility };
  if (!eligibility.pullRequestNumber) throw new Error('A pull request number is required to enable automatic merge.');
  const runner = options.runner || defaultRun;
  const result = runner('gh', [
    'pr', 'merge', String(eligibility.pullRequestNumber), '--auto', '--merge',
  ], { cwd: root, allowFailure: true });
  if (result.ok) return { requested: true, enabled: true, eligibility, reason: null };
  return {
    requested: true,
    enabled: false,
    eligibility,
    reason: text(result.stderr || result.stdout) || 'GitHub auto-merge could not be enabled.',
    action: 'Leave the pull request open and satisfy repository checks, reviews, protections, and rulesets. Never bypass repository policy.',
  };
}

export function invalidateApprovedMergeAfterHeadChange(state = {}, newHeadSha) {
  const next = text(newHeadSha);
  if (!next) throw new Error('A new pull request head SHA is required.');
  if (next === text(state.currentHeadSha)) return { ...state };
  return {
    ...state,
    currentHeadSha: next,
    approvedHeadSha: null,
    reviewApproved: false,
    validationHeadSha: null,
    validationApproved: false,
    autoMergeEligible: false,
    autoMergeRequestedAt: null,
  };
}

export function verifyMergedPullRequestCompletion({
  pullRequest = {},
  issue = {},
  configuredBaseBranch = '',
  baseContainsMergeCommit = false,
} = {}) {
  const issueNumber = Number(pullRequest.issueNumber);
  const linkedIssue = Number(issue.number);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    return { complete: false, needsAttention: true, reason: 'missing-linked-issue' };
  }
  if (linkedIssue !== issueNumber) {
    return { complete: false, needsAttention: true, reason: 'linked-issue-mismatch' };
  }
  if (pullRequest.state === 'closed' && pullRequest.merged !== true) {
    return { complete: false, needsAttention: true, reason: 'pull-request-closed-unmerged' };
  }
  if (pullRequest.merged !== true) {
    return { complete: false, needsAttention: false, reason: 'pull-request-not-merged' };
  }
  if (!text(pullRequest.mergeCommitSha)) {
    return { complete: false, needsAttention: true, reason: 'merge-commit-missing' };
  }
  if (text(pullRequest.baseBranch) !== text(configuredBaseBranch)) {
    return { complete: false, needsAttention: true, reason: 'merged-to-wrong-base' };
  }
  if (!baseContainsMergeCommit) {
    return { complete: false, needsAttention: false, reason: 'merge-not-yet-visible-on-base' };
  }
  if (issue.state !== 'closed') {
    return { complete: false, needsAttention: false, reason: 'linked-issue-not-yet-closed' };
  }
  return {
    complete: true,
    needsAttention: false,
    reason: null,
    issueNumber,
    mergeCommitSha: pullRequest.mergeCommitSha,
  };
}

export function baseContainsMergeCommit(root, mergeCommitSha, baseBranch, options = {}) {
  const runner = options.runner || defaultRun;
  const merge = text(mergeCommitSha);
  const base = text(baseBranch);
  if (!merge || !base) return false;
  const result = runner('git', ['merge-base', '--is-ancestor', merge, `origin/${base}`], {
    cwd: root,
    allowFailure: true,
  });
  return result.ok;
}

export function reconcileMergedCodingPullRequest(root, {
  repository,
  pullRequestNumber,
  issueNumber,
  configuredBaseBranch,
} = {}, options = {}) {
  const jsonRunner = options.jsonRunner || defaultRunJson;
  const pr = jsonRunner('gh', [
    'pr', 'view', String(pullRequestNumber), '--repo', repository,
    '--json', 'number,state,mergedAt,mergeCommit,headRefOid,baseRefName,body',
  ], { cwd: root, allowFailure: false });
  const issue = jsonRunner('gh', [
    'issue', 'view', String(issueNumber), '--repo', repository, '--json', 'number,state',
  ], { cwd: root, allowFailure: false });
  const normalized = {
    number: Number(pr.number),
    state: String(pr.state || '').toLowerCase(),
    merged: Boolean(pr.mergedAt),
    mergeCommitSha: text(pr.mergeCommit?.oid),
    headSha: text(pr.headRefOid),
    baseBranch: text(pr.baseRefName),
    issueNumber: Number(issueNumber),
  };
  const present = normalized.merged
    ? (options.baseVerifier || baseContainsMergeCommit)(root, normalized.mergeCommitSha, configuredBaseBranch, options)
    : false;
  return verifyMergedPullRequestCompletion({
    pullRequest: normalized,
    issue: { number: Number(issue.number), state: String(issue.state || '').toLowerCase() },
    configuredBaseBranch,
    baseContainsMergeCommit: present,
  });
}
