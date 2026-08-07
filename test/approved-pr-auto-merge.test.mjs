import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedPullRequestMergeEligibility,
  ensureCodingPullRequestBody,
  invalidateApprovedMergeAfterHeadChange,
  requestApprovedPullRequestAutoMerge,
  verifyMergedPullRequestCompletion,
} from '../src/approved-pr-auto-merge.mjs';

function eligibleContext(overrides = {}) {
  return {
    config: { baseBranch: 'main', review: { workflow: 'full-immediate', autoMergeApproved: true } },
    pullRequest: {
      number: 14,
      issueNumber: 8,
      headSha: 'abc123',
      baseBranch: 'main',
      checksPassed: true,
      mergeable: true,
      state: 'open',
    },
    review: { approved: true, approvedHeadSha: 'abc123', findings: [], unresolvedFindings: false },
    validation: { passed: true, headSha: 'abc123' },
    currentBaseBranch: 'main',
    paseoOwned: true,
    ...overrides,
  };
}

test('auto-merge is opt-in and limited to approved non-manual workflows', () => {
  assert.equal(approvedPullRequestMergeEligibility(eligibleContext()).eligible, true);
  assert.equal(approvedPullRequestMergeEligibility(eligibleContext({
    config: { baseBranch: 'main', review: { workflow: 'quick-web-chatgpt', autoMergeApproved: true } },
  })).eligible, true);
  const manual = approvedPullRequestMergeEligibility(eligibleContext({
    config: { baseBranch: 'main', review: { workflow: 'quick-manual', autoMergeApproved: true } },
  }));
  assert.equal(manual.eligible, false);
  assert.ok(manual.reasons.includes('workflow-not-eligible'));
  const disabled = approvedPullRequestMergeEligibility(eligibleContext({
    config: { baseBranch: 'main', review: { workflow: 'full-immediate', autoMergeApproved: false } },
  }));
  assert.ok(disabled.reasons.includes('auto-merge-disabled'));
});

test('quick review alone and stale exact-head approval cannot authorize merge', () => {
  const stale = approvedPullRequestMergeEligibility(eligibleContext({
    review: { approved: true, approvedHeadSha: 'old-head', findings: [], unresolvedFindings: false },
  }));
  assert.ok(stale.reasons.includes('exact-head-not-approved'));
  const findings = approvedPullRequestMergeEligibility(eligibleContext({
    review: { approved: true, approvedHeadSha: 'abc123', findings: [{ severity: 'blocking', message: 'fix me' }] },
  }));
  assert.ok(findings.reasons.includes('unresolved-review-findings'));
  const unvalidated = approvedPullRequestMergeEligibility(eligibleContext({
    validation: { passed: false, headSha: 'abc123' },
  }));
  assert.ok(unvalidated.reasons.includes('exact-head-validation-not-passed'));
});

test('merge eligibility requires checks, current base, mergeability, and Paseo ownership', () => {
  const result = approvedPullRequestMergeEligibility(eligibleContext({
    paseoOwned: false,
    currentBaseBranch: 'release',
    pullRequest: {
      number: 14,
      issueNumber: 8,
      headSha: 'abc123',
      baseBranch: 'main',
      checksPassed: false,
      mergeable: false,
      state: 'open',
    },
  }));
  assert.ok(result.reasons.includes('unrecognized-paseo-ownership'));
  assert.ok(result.reasons.includes('required-checks-not-passed'));
  assert.ok(result.reasons.includes('base-target-not-current'));
  assert.ok(result.reasons.includes('pull-request-not-mergeable'));
});

test('requesting auto-merge uses GitHub policy rather than bypass flags', () => {
  let args = null;
  const result = requestApprovedPullRequestAutoMerge('/repo', eligibleContext(), {
    runner(_command, commandArgs) {
      args = commandArgs;
      return { ok: false, stdout: '', stderr: 'branch protection blocks auto merge', exitCode: 1 };
    },
  });
  assert.deepEqual(args, ['pr', 'merge', '14', '--auto', '--merge']);
  assert.equal(result.enabled, false);
  assert.match(result.action, /Never bypass repository policy/);
});

test('coding PR bodies close only the explicitly linked issue', () => {
  assert.equal(ensureCodingPullRequestBody('Implementation details', 42), 'Implementation details\n\nCloses #42');
  assert.equal(ensureCodingPullRequestBody('Implementation details\n\nFixes #42', 42), 'Implementation details\n\nFixes #42');
  assert.doesNotMatch(ensureCodingPullRequestBody('Refs #41', 42), /Closes #41/);
});

test('a new PR head invalidates review, validation, and pending merge eligibility', () => {
  const next = invalidateApprovedMergeAfterHeadChange({
    currentHeadSha: 'old',
    approvedHeadSha: 'old',
    reviewApproved: true,
    validationHeadSha: 'old',
    validationApproved: true,
    autoMergeEligible: true,
    autoMergeRequestedAt: 'now',
  }, 'new');
  assert.equal(next.currentHeadSha, 'new');
  assert.equal(next.reviewApproved, false);
  assert.equal(next.approvedHeadSha, null);
  assert.equal(next.validationApproved, false);
  assert.equal(next.autoMergeEligible, false);
});

test('completion waits for merge commit on configured base and GitHub issue closure', () => {
  const pr = {
    state: 'closed', merged: true, mergeCommitSha: 'merge123', baseBranch: 'main', issueNumber: 8,
  };
  assert.equal(verifyMergedPullRequestCompletion({
    pullRequest: pr, issue: { number: 8, state: 'closed' }, configuredBaseBranch: 'main', baseContainsMergeCommit: true,
  }).complete, true);
  assert.equal(verifyMergedPullRequestCompletion({
    pullRequest: pr, issue: { number: 8, state: 'closed' }, configuredBaseBranch: 'main', baseContainsMergeCommit: false,
  }).complete, false);
  assert.equal(verifyMergedPullRequestCompletion({
    pullRequest: { ...pr, merged: false }, issue: { number: 8, state: 'open' }, configuredBaseBranch: 'main', baseContainsMergeCommit: false,
  }).needsAttention, true);
  assert.equal(verifyMergedPullRequestCompletion({
    pullRequest: pr, issue: { number: 9, state: 'closed' }, configuredBaseBranch: 'main', baseContainsMergeCommit: true,
  }).reason, 'linked-issue-mismatch');
});
