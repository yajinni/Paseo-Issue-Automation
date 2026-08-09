import assert from 'node:assert/strict';
import test from 'node:test';
import { managerRepositoryAction } from '../src/manager-actions.mjs';

function actions(calls) {
  return {
    reconcileIssuePullRequest(root, issueNumber, options) {
      calls.push(['reconcile-pr', root, issueNumber, options]);
      return { action: 'reconciled', issueNumber, pullRequestNumber: options.pullRequestNumber || 77 };
    },
    retryIssuePullRequestReview(root, issueNumber, options) {
      calls.push(['retry-pr-review', root, issueNumber, options]);
      return { action: 'review-retried', issueNumber, pullRequestNumber: options.pullRequestNumber || 77, headSha: options.expectedHeadSha || 'abcdef1' };
    },
    appendControllerLog(root, entry) { calls.push(['controller-log', root, entry]); return entry; },
    appendIssueLifecycle(root, issueNumber, entry) { calls.push(['lifecycle', root, issueNumber, entry]); return entry; },
  };
}

test('manager routes Reconcile now to the current issue PR helper', () => {
  const calls = [];
  const result = managerRepositoryAction('/repo', '/api/reconcile-pr', { issueNumber: 42 }, actions(calls));
  assert.equal(result.action, 'reconciled');
  assert.deepEqual(calls.find((entry) => entry[0] === 'reconcile-pr'), ['reconcile-pr', '/repo', 42, { pullRequestNumber: null }]);
  const lifecycle = calls.find((entry) => entry[0] === 'lifecycle');
  assert.equal(lifecycle[2], 42);
  assert.match(lifecycle[3].message, /Reconcile PR completed/);
  assert.equal(lifecycle[3].evidence.action, 'reconcile-pr');
});

test('manager routes retry with optional PR/head identity and records operator evidence', () => {
  const calls = [];
  const result = managerRepositoryAction('/repo', '/api/retry-pr-review', {
    issueNumber: 42,
    pullRequestNumber: 77,
    expectedHeadSha: 'abcdef1',
  }, actions(calls));
  assert.equal(result.action, 'review-retried');
  assert.deepEqual(calls.find((entry) => entry[0] === 'retry-pr-review'), [
    'retry-pr-review', '/repo', 42, { pullRequestNumber: 77, expectedHeadSha: 'abcdef1' },
  ]);
  const lifecycle = calls.find((entry) => entry[0] === 'lifecycle');
  assert.match(lifecycle[3].message, /Retry PR review completed/);
  assert.equal(lifecycle[3].evidence.pullRequestNumber, 77);
  assert.equal(lifecycle[3].evidence.expectedHeadSha, 'abcdef1');
});

test('failed PR recovery action is appended to issue lifecycle before the error is rethrown', () => {
  const calls = [];
  const fake = actions(calls);
  fake.retryIssuePullRequestReview = () => { throw new Error('head changed'); };
  assert.throws(() => managerRepositoryAction('/repo', '/api/retry-pr-review', {
    issueNumber: 42,
    pullRequestNumber: 77,
  }, fake), /head changed/);
  const lifecycle = calls.find((entry) => entry[0] === 'lifecycle');
  assert.equal(lifecycle[3].status, 'failed');
  assert.match(lifecycle[3].message, /Retry PR review failed/);
  assert.match(lifecycle[3].evidence.error, /head changed/);
});

test('PR recovery routes still validate issue number before acting', () => {
  assert.throws(() => managerRepositoryAction('/repo', '/api/reconcile-pr', { issueNumber: 0 }, actions([])), /positive issueNumber/);
  assert.throws(() => managerRepositoryAction('/repo', '/api/retry-pr-review', { issueNumber: -1 }, actions([])), /positive issueNumber/);
});
