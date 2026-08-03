import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { claimNextReview, enqueueManagedReview, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, savePrAutomationConfig, setReviewQueuePaused } from '../src/pr-review-store.mjs';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-review-queue-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true, reviewDebounceMs: 1000 },
    reviewQueue: { paused: false },
  });
  return root;
}

function managedInput(sha) {
  return {
    repository: 'owner/repo', issueNumber: 101, issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45, pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    branchName: 'ai/issue-101', workspaceId: 'workspace-1', currentHeadSha: sha,
  };
}

test('PR creation persists one deduplicated review job', (t) => {
  const root = repo(t);
  registerManagedPullRequest(root, managedInput('abcdef123'), { now: 1000 });
  registerManagedPullRequest(root, managedInput('abcdef123'), { now: 1100 });
  const store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests.length, 1);
  assert.equal(store.reviewJobs.length, 1);
  assert.equal(store.reviewJobs[0].dueAt, new Date(2000).toISOString());
});

test('new head supersedes old queued review and debounces the latest SHA', (t) => {
  const root = repo(t);
  registerManagedPullRequest(root, managedInput('abcdef123'), { now: 1000 });
  registerManagedPullRequest(root, managedInput('abcdef456'), { now: 1500 });
  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.length, 2);
  assert.equal(store.reviewJobs.find((job) => job.headSha === 'abcdef123').state, 'superseded');
  assert.equal(store.reviewJobs.find((job) => job.headSha === 'abcdef456').dueAt, new Date(2500).toISOString());
});

test('serial queue claims one due review and paused queue claims none', (t) => {
  const root = repo(t);
  registerManagedPullRequest(root, managedInput('abcdef123'), { now: 1000 });
  assert.equal(claimNextReview(root, { now: 2500 }).state, 'submitting');
  assert.equal(claimNextReview(root, { now: 2500 }), null);
  setReviewQueuePaused(root, true);
  registerManagedPullRequest(root, { ...managedInput('abcdef789'), pullRequestNumber: 46, pullRequestUrl: 'https://github.com/owner/repo/pull/46' }, { now: 3000 });
  assert.equal(claimNextReview(root, { now: 5000 }), null);
});

test('one-time conversation override updates the existing deduplicated queued job only', (t) => {
  const root = repo(t);
  const registered = registerManagedPullRequest(root, managedInput('abcdef123'), { now: 1000 });
  const review = enqueueManagedReview(root, registered.managed.id, {
    immediate: true,
    now: 1500,
    conversationUrlOverride: 'https://chatgpt.com/c/one-time',
  });
  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.length, 1);
  assert.equal(review.conversationUrlOverride, 'https://chatgpt.com/c/one-time');
  assert.equal(review.dueAt, new Date(1500).toISOString());
  assert.equal(store.config.browserReview.projectConversationUrl, null);
  assert.equal(store.managedPullRequests[0].conversationUrlOverride, null);
});
