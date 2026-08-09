import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileIssuePullRequest,
  retryIssuePullRequestReview,
} from '../src/manager-pr-actions.mjs';

const head = 'abcdef1234567890';

function baseStore(overrides = {}) {
  return {
    config: {
      enabled: true,
      browserReview: { enabled: true },
    },
    managedPullRequests: [{
      id: 'managed-42-77',
      issueNumber: 42,
      pullRequestNumber: 77,
      currentHeadSha: head,
      reviewState: 'failed',
      ...overrides.managed,
    }],
    reviewJobs: [{
      id: 'review-1',
      managedPullRequestId: 'managed-42-77',
      headSha: head,
      reviewRequestId: 'request-1',
      state: 'failed',
      updatedAt: '2026-08-09T12:00:00.000Z',
      ...overrides.job,
    }],
  };
}

function runLoader(_root, issueNumber) {
  assert.equal(issueNumber, 42);
  return { issueNumber: 42, prNumber: 77 };
}

function snapshotLoader(_root, prNumber) {
  assert.equal(prNumber, 77);
  return { number: 77, state: 'OPEN', mergedAt: null, headRefOid: head };
}

test('Reconcile now resolves the PR from the current issue run and reconciles that exact managed record', () => {
  const calls = [];
  const result = reconcileIssuePullRequest('/repo', 42, {
    loadStore: () => baseStore(),
    runLoader,
    reconcile(root, managedId) { calls.push([root, managedId]); return { state: 'queued', headChanged: true }; },
  });
  assert.deepEqual(calls, [['/repo', 'managed-42-77']]);
  assert.equal(result.issueNumber, 42);
  assert.equal(result.pullRequestNumber, 77);
  assert.equal(result.managedPullRequestId, 'managed-42-77');
  assert.equal(result.result.headChanged, true);
});

test('an explicit stale PR number is rejected instead of acting on a historical PR', () => {
  assert.throws(() => reconcileIssuePullRequest('/repo', 42, {
    pullRequestNumber: 70,
    loadStore: () => baseStore(),
    runLoader,
    reconcile() { throw new Error('must not run'); },
  }), /currently records PR #77, not PR #70/);
});

test('Retry PR review requeues only a failed exact-current-head browser job', () => {
  const calls = [];
  const result = retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => baseStore(),
    runLoader,
    snapshotLoader,
    enqueue(root, managedId, options) {
      calls.push([root, managedId, options]);
      return { id: 'review-1', reviewRequestId: 'request-2', state: 'queued' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'managed-42-77');
  assert.deepEqual(calls[0][2], { headSha: head, immediate: true, forceRetry: true });
  assert.equal(result.action, 'review-retried');
  assert.equal(result.headSha, head);
  assert.equal(result.state, 'queued');
});

test('Retry PR review can create the missing exact-head job when no job exists', () => {
  const state = baseStore(); state.reviewJobs = [];
  let options = null;
  const result = retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => state,
    runLoader,
    snapshotLoader,
    enqueue(_root, _managedId, input) { options = input; return { id: 'new-job', reviewRequestId: 'new-request', state: 'queued' }; },
  });
  assert.deepEqual(options, { headSha: head, immediate: true, forceRetry: false });
  assert.equal(result.action, 'review-queued');
});

test('Retry PR review refuses active, completed, and paused review states', () => {
  for (const state of ['queued', 'submitting', 'awaiting_result', 'completed']) {
    assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
      loadStore: () => baseStore({ job: { state } }),
      runLoader,
      snapshotLoader,
      enqueue() { throw new Error('must not enqueue'); },
    }), new RegExp(`exact-head review job is ${state}`));
  }
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => baseStore({ managed: { reviewState: 'paused' } }),
    runLoader,
    snapshotLoader,
  }), /is paused/);
});

test('Retry PR review refuses a moved GitHub head until reconciliation updates managed state', () => {
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => baseStore(),
    runLoader,
    snapshotLoader() { return { number: 77, state: 'OPEN', headRefOid: 'fedcba9876543210' }; },
    enqueue() { throw new Error('must not enqueue'); },
  }), /managed head .* does not match GitHub head .* Reconcile the PR first/);
});

test('Retry PR review respects an explicit expected-head guard', () => {
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    expectedHeadSha: '1111111',
    loadStore: () => baseStore(),
    runLoader,
    snapshotLoader,
    enqueue() { throw new Error('must not enqueue'); },
  }), /moved from expected head 1111111/);
});

test('Retry PR review fails closed when browser PR-review automation is disabled', () => {
  const state = baseStore(); state.config.browserReview.enabled = false;
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => state,
    runLoader,
    snapshotLoader,
  }), /Web ChatGPT PR-review automation is not enabled/);
});

test('Retry PR review refuses merged or closed PR snapshots', () => {
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => baseStore(),
    runLoader,
    snapshotLoader() { return { number: 77, state: 'MERGED', mergedAt: '2026-08-09T12:00:00.000Z', headRefOid: head }; },
  }), /already merged/);
  assert.throws(() => retryIssuePullRequestReview('/repo', 42, {
    loadStore: () => baseStore(),
    runLoader,
    snapshotLoader() { return { number: 77, state: 'CLOSED', headRefOid: head }; },
  }), /is not open/);
});
