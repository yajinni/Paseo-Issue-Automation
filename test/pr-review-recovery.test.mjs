import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { recoverPrReviewState, reconcileManagedPullRequest } from '../src/pr-review-reconcile.mjs';

const noEffects = () => [];

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-review-recovery-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  savePrAutomationConfig(root, { enabled: true, browserReview: { enabled: true, reviewDebounceMs: 0 }, reviewQueue: { paused: false } });
  return root;
}

function register(root) {
  return registerManagedPullRequest(root, {
    repository: 'owner/repo', issueNumber: 101, issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45, pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    branchName: 'ai/issue-101', workspaceId: 'workspace-1', currentHeadSha: 'abcdef123',
  }, { now: 1000 }).managed;
}

test('startup recovery returns interrupted review and fix workers to recoverable states', (t) => {
  const root = repo(t);
  const managed = register(root);
  mutatePrReviewStore(root, (store) => {
    store.reviewJobs[0].state = 'submitting';
    store.runtime.activeReviewJobId = store.reviewJobs[0].id;
    store.fixJobs.push({
      id: 'fix-1', managedPullRequestId: managed.id, reviewJobId: store.reviewJobs[0].id,
      reviewRequestId: store.reviewJobs[0].reviewRequestId, repository: 'owner/repo', pullRequestNumber: 45,
      issueNumber: 101, branchName: 'ai/issue-101', reviewedHeadSha: 'abcdef123', findings: 'Fix it',
      state: 'fixing', priority: 0, attempts: 1, createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString(),
    });
  });
  recoverPrReviewState(root, { now: 5000, effectRunner: noEffects });
  const store = loadPrReviewStore(root);
  assert.equal(store.runtime.activeReviewJobId, null);
  assert.equal(store.reviewJobs[0].state, 'queued');
  assert.equal(store.fixJobs[0].state, 'interrupted');
});

test('closed without merge becomes an operator state and never success', (t) => {
  const root = repo(t);
  const managed = register(root);
  reconcileManagedPullRequest(root, managed.id, {
    now: 5000,
    snapshot: { state: 'CLOSED', mergedAt: null, headRefOid: 'abcdef123' },
    effectRunner: noEffects,
  });
  const record = loadPrReviewStore(root).managedPullRequests[0];
  assert.equal(record.reviewState, 'closed_unmerged');
  assert.match(record.lastError, /Closed without merge/);
});
