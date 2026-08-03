import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cancelQueuedReview,
  nextDueReview,
  pauseManagedPr,
  registerManagedPullRequest,
} from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { reconcileManagedPullRequest, reconcileManagedPullRequests } from '../src/pr-review-reconcile.mjs';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-review-lifecycle-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  savePrAutomationConfig(root, { enabled: true, browserReview: { enabled: true, reviewDebounceMs: 0 } });
  return root;
}

function register(root, pullRequestNumber = 45, issueNumber = 101) {
  return registerManagedPullRequest(root, {
    repository: 'owner/repo', issueNumber,
    issueUrl: `https://github.com/owner/repo/issues/${issueNumber}`,
    pullRequestNumber,
    pullRequestUrl: `https://github.com/owner/repo/pull/${pullRequestNumber}`,
    branchName: `ai/issue-${issueNumber}`,
    workspaceId: `workspace-${issueNumber}`,
    currentHeadSha: `abcdef${issueNumber}`,
  }, { now: 1000 }).managed;
}

test('a paused PR at the front of the queue does not starve later reviews', (t) => {
  const root = repo(t);
  const first = register(root, 45, 101);
  register(root, 46, 102);
  pauseManagedPr(root, first.id, true);
  const store = loadPrReviewStore(root);
  const due = nextDueReview(store, 5000);
  assert.equal(due.pullRequestNumber, 46);
});

test('cancelling the last queued review clears managed queue state', (t) => {
  const root = repo(t);
  const managed = register(root);
  const job = loadPrReviewStore(root).reviewJobs[0];
  cancelQueuedReview(root, job.id);
  const store = loadPrReviewStore(root);
  const record = store.managedPullRequests.find((item) => item.id === managed.id);
  assert.equal(store.reviewJobs[0].state, 'cancelled');
  assert.equal(record.reviewState, 'paused');
  assert.equal(record.activeReviewRequestId, null);
  assert.equal(record.queuePosition, null);
});

test('terminal PR reconciliation cancels review and fix jobs', (t) => {
  const root = repo(t);
  const managed = register(root);
  mutatePrReviewStore(root, (store) => {
    store.fixJobs.push({
      id: 'fix-1', managedPullRequestId: managed.id, reviewJobId: store.reviewJobs[0].id,
      reviewRequestId: store.reviewJobs[0].reviewRequestId, repository: 'owner/repo', pullRequestNumber: 45,
      issueNumber: 101, branchName: 'ai/issue-101', reviewedHeadSha: 'abcdef101', findings: 'Fix it',
      state: 'queued', priority: 0, attempts: 0, createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString(),
    });
  });
  reconcileManagedPullRequest(root, managed.id, {
    now: 5000,
    snapshot: { state: 'CLOSED', mergedAt: null, headRefOid: 'abcdef101' },
  });
  const store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests[0].reviewState, 'closed_unmerged');
  assert.equal(store.reviewJobs[0].state, 'cancelled');
  assert.equal(store.fixJobs[0].state, 'cancelled');
});

test('operator-paused records are not reverted by reconciliation', (t) => {
  const root = repo(t);
  const managed = register(root);
  pauseManagedPr(root, managed.id, true);
  const result = reconcileManagedPullRequests(root, { now: 5000 });
  assert.equal(result.checked, 0);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'paused');
});
