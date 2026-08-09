import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPrHealth,
  managerPrHealthSummary,
  summarizePrChecks,
} from '../src/manager-pr-health.mjs';

function run(overrides = {}) {
  return {
    issueNumber: 42,
    issueTitle: 'PR health test',
    phase: 'reviewing',
    prNumber: 77,
    prUrl: 'https://github.com/example/repo/pull/77',
    currentHeadSha: 'head-current',
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    number: 77,
    url: 'https://github.com/example/repo/pull/77',
    state: 'OPEN',
    isDraft: false,
    headRefOid: 'head-current',
    headRefName: 'ai/issue-42',
    baseRefName: 'main',
    mergedAt: null,
    closedAt: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    body: 'Closes #42',
    closingIssuesReferences: [{ number: 42 }],
    ...overrides,
  };
}

test('healthy current PR reports passing checks and no problems', () => {
  const health = classifyPrHealth({ run: run(), snapshot: snapshot() });
  assert.equal(health.status, 'healthy');
  assert.equal(health.label, 'Healthy');
  assert.equal(health.problemCount, 0);
  assert.equal(health.checks.passingCount, 1);
  assert.equal(health.currentPr.headSha, 'head-current');
  assert.equal(health.currentPr.issueAssociation, true);
});

test('failed checks, merge conflicts, and requested changes are blocking PR problems', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: snapshot({
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      reviewDecision: 'CHANGES_REQUESTED',
      statusCheckRollup: [
        { name: 'test (22)', conclusion: 'FAILURE' },
        { name: 'lint', conclusion: 'SUCCESS' },
      ],
    }),
  });
  assert.equal(health.status, 'blocking');
  assert.equal(health.blockingCount, 3);
  assert.deepEqual(
    health.problems.map((item) => item.code).sort(),
    ['checks-failed', 'github-changes-requested', 'merge-conflict'],
  );
  assert.match(health.problems.find((item) => item.code === 'checks-failed').message, /test \(22\): FAILURE/);
});

test('draft, pending checks, required review, and behind-base state are waiting rather than confirmed failures', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: snapshot({
      isDraft: true,
      mergeStateStatus: 'BEHIND',
      reviewDecision: 'REVIEW_REQUIRED',
      statusCheckRollup: [{ name: 'CI', status: 'IN_PROGRESS' }],
    }),
  });
  assert.equal(health.status, 'waiting');
  assert.equal(health.blockingCount, 0);
  assert.equal(health.attentionCount, 0);
  assert.equal(health.waitingCount, 4);
  assert.ok(health.problems.every((item) => item.severity === 'waiting'));
});

test('exact-head approval and validation become blocking when the PR head changes', () => {
  const health = classifyPrHealth({
    run: run({
      reviewApproved: true,
      approvedHeadSha: 'approved-old',
      validationApproved: true,
      validationHeadSha: 'validated-old',
    }),
    snapshot: snapshot({ headRefOid: 'head-new' }),
  });
  assert.equal(health.status, 'blocking');
  assert.deepEqual(
    health.problems.map((item) => item.code).sort(),
    ['review-approval-stale', 'validation-stale'],
  );
});

test('a completed review on an older head is waiting when current head is already queued for re-review', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: snapshot({ headRefOid: 'head-new' }),
    managed: {
      reviewState: 'queued',
      currentHeadSha: 'head-new',
      lastCompletedReviewSha: 'head-old',
    },
  });
  const stale = health.problems.find((item) => item.code === 'reviewed-head-stale');
  assert.equal(stale.severity, 'waiting');
  assert.equal(health.status, 'waiting');
});

test('missing issue-closing association is an attention problem before merge completion', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: snapshot({ body: 'Implements retry logic', closingIssuesReferences: [] }),
  });
  assert.equal(health.status, 'attention');
  assert.equal(health.attentionCount, 1);
  assert.equal(health.problems[0].code, 'issue-association-missing');
  assert.equal(health.currentPr.issueAssociation, false);
});

test('closed-unmerged PR is a blocking condition', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: snapshot({ state: 'CLOSED', closedAt: '2026-08-09T12:00:00.000Z', mergedAt: null }),
  });
  assert.equal(health.status, 'blocking');
  assert.ok(health.problems.some((item) => item.code === 'closed-unmerged'));
});

test('merged PR with pending issue closure reconciliation is attention state', () => {
  const health = classifyPrHealth({
    run: run({ phase: 'merged', mergedAt: '2026-08-09T12:00:00.000Z' }),
    snapshot: snapshot({ state: 'MERGED', mergedAt: '2026-08-09T12:00:00.000Z' }),
    managed: {
      reviewState: 'merged',
      issueClosurePending: true,
      lifecycleCompletionPending: true,
    },
  });
  assert.equal(health.status, 'attention');
  assert.ok(health.problems.some((item) => item.code === 'issue-closure-pending'));
});

test('unavailable GitHub snapshot is explicit and does not pretend the PR is healthy', () => {
  const health = classifyPrHealth({
    run: run(),
    snapshot: null,
    snapshotError: 'gh auth expired',
  });
  assert.equal(health.status, 'unavailable');
  assert.equal(health.snapshotAvailable, false);
  assert.equal(health.problems[0].code, 'github-pr-unavailable');
  assert.match(health.problems[0].message, /gh auth expired/);
});

test('summary diagnoses only the current PR store record and caches duplicate PR snapshot reads', () => {
  const store = {
    managedPullRequests: [
      {
        id: 'old',
        issueNumber: 42,
        pullRequestNumber: 70,
        reviewState: 'failed',
        lastError: 'old PR failure',
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
      {
        id: 'current',
        issueNumber: 42,
        pullRequestNumber: 77,
        reviewState: 'ready_to_merge',
        currentHeadSha: 'head-current',
        lastCompletedReviewSha: 'head-current',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
    ],
    reviewJobs: [],
    fixJobs: [],
  };
  let reads = 0;
  const summary = managerPrHealthSummary([
    run(),
    run({ issueNumber: 43, prNumber: 77, issueTitle: 'Second record sharing PR for cache test' }),
  ], store, {
    loadSnapshot() {
      reads += 1;
      return snapshot({ closingIssuesReferences: [{ number: 42 }, { number: 43 }], body: 'Closes #42\nCloses #43' });
    },
  });
  assert.equal(reads, 1);
  assert.equal(summary.byIssue['42'].status, 'healthy');
  assert.equal(summary.byIssue['42'].problems.some((item) => /old PR failure/.test(item.message)), false);
  assert.equal(summary.counts.withPullRequest, 2);
});

test('check summary keeps failed, pending, passing, and unknown checks distinct', () => {
  const checks = summarizePrChecks([
    { name: 'failed', conclusion: 'FAILURE' },
    { name: 'pending', status: 'QUEUED' },
    { name: 'passed', conclusion: 'SUCCESS' },
    { name: 'odd', conclusion: 'STALE' },
  ]);
  assert.equal(checks.failedCount, 1);
  assert.equal(checks.pendingCount, 1);
  assert.equal(checks.passingCount, 1);
  assert.equal(checks.unknownCount, 1);
});
