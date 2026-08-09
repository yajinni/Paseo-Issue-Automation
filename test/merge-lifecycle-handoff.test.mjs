import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { markIssueMerged } from '../src/issue-merge-state.mjs';
import {
  claimNextReview,
  markReviewSubmitted,
  registerManagedPullRequest,
} from '../src/pr-review-queue.mjs';
import {
  reconcileManagedPullRequest,
  reconcileManagedPullRequests,
} from '../src/pr-review-reconcile.mjs';
import {
  loadPrReviewStore,
  mutatePrReviewStore,
  savePrAutomationConfig,
} from '../src/pr-review-store.mjs';
import { renderReviewPrompt } from '../src/review-prompt.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

const head = 'abcdef1234567890';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-merge-lifecycle-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function seedRun(root, { approved = true } = {}) {
  const events = [
    { event: 'validation-summary', result: 'PASS', commit: head, at: '2026-08-09T01:00:00.000Z' },
  ];
  if (approved) {
    events.push({
      event: 'review', result: 'APPROVED', commit: head, source: 'browser-review',
      reviewRequestId: 'review-seed', at: '2026-08-09T01:01:00.000Z',
    });
  }
  saveRun(root, 101, {
    issueNumber: 101,
    attempt: 1,
    status: 'paseo:review-queued',
    phase: 'review-queued',
    prNumber: 45,
    prUrl: 'https://github.com/owner/repo/pull/45',
    events,
    activity: [],
    completedAt: '2026-08-09T00:59:00.000Z',
  });
}

function configureReviews(root) {
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true, reviewDebounceMs: 1000 },
    reviewQueue: { paused: false },
  });
}

function managedInput() {
  return {
    repository: 'owner/repo',
    issueNumber: 101,
    issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    branchName: 'ai/issue-101',
    workspaceId: 'workspace-1',
    currentHeadSha: head,
  };
}

test('review prompt leaves repair dispatch to Paseo and requires approval evidence before merge', () => {
  const prompt = renderReviewPrompt({
    repository: 'owner/repo',
    pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    issueNumber: 101,
    issueUrl: 'https://github.com/owner/repo/issues/101',
    headSha: head,
    reviewRound: 2,
    reviewRequestId: 'review-2',
    allowChatGPTMerge: true,
  });
  assert.match(prompt, /authoritative repair handoff/i);
  assert.match(prompt, /Do not launch, contact, or independently instruct a coding agent/i);
  assert.match(prompt, /Paseo reconciliation owns creation of the repair job/i);
  assert.match(prompt, /authoritative approval evidence and must be posted before merge/i);
  assert.match(prompt, new RegExp(`current head still equals ${head}`, 'i'));
  assert.match(prompt, new RegExp(`${head} as the expected head SHA`, 'i'));
  assert.doesNotMatch(prompt, /\{\{headSha\}\}/);
  assert.doesNotMatch(prompt, /Tell the coding agent to update/i);
});

test('issue merge completion requires exact validation and approval evidence and is idempotent', (t) => {
  const root = repo(t);
  seedRun(root);
  const first = markIssueMerged(root, {
    issueNumber: 101,
    pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    headSha: head,
    mergedAt: '2026-08-09T01:02:00.000Z',
    issueClosureVerifiedAt: '2026-08-09T01:03:00.000Z',
  });
  assert.equal(first.status, 'merged');
  assert.equal(first.phase, 'merged');
  assert.equal(first.approvedCommit, head);
  assert.equal(first.mergedHeadSha, head);
  assert.equal(first.mergedAt, '2026-08-09T01:02:00.000Z');
  assert.equal(first.issueClosureVerifiedAt, '2026-08-09T01:03:00.000Z');
  assert.equal(first.completedAt, '2026-08-09T01:02:00.000Z');
  assert.equal(first.activity.filter((entry) => entry.type === 'pr-merged').length, 1);

  const second = markIssueMerged(root, {
    issueNumber: 101,
    pullRequestNumber: 45,
    headSha: head,
    mergedAt: '2026-08-09T01:02:00.000Z',
    issueClosureVerifiedAt: '2026-08-09T01:04:00.000Z',
  });
  assert.equal(second.activity.filter((entry) => entry.type === 'pr-merged').length, 1);
});

test('issue merge completion fails closed without exact approved review evidence', (t) => {
  const root = repo(t);
  seedRun(root, { approved: false });
  assert.throws(() => markIssueMerged(root, {
    issueNumber: 101,
    pullRequestNumber: 45,
    headSha: head,
    mergedAt: '2026-08-09T01:02:00.000Z',
  }), /without exact PASS validation and APPROVED review evidence/);
  assert.equal(loadRun(root, 101).phase, 'review-queued');
});

test('merged snapshot preserves an exact approval that arrives in the same poll as merge', (t) => {
  const root = repo(t);
  configureReviews(root);
  seedRun(root, { approved: false });
  const registered = registerManagedPullRequest(root, managedInput(), { now: 1000 });
  const claimed = claimNextReview(root, { now: 2500 });
  assert.ok(claimed);
  markReviewSubmitted(root, claimed.id, {
    submittedAt: new Date(3000).toISOString(),
    conversationUrl: 'https://chatgpt.com/c/review',
  });
  const marker = `<!-- paseo-review:v1\n${JSON.stringify({
    reviewRequestId: claimed.reviewRequestId,
    repository: 'owner/repo',
    pullRequestNumber: 45,
    issueNumber: 101,
    headSha: head,
    reviewRound: claimed.reviewRound,
    promptVersion: claimed.promptVersion,
    result: 'approved',
  })}\n-->\nApproved exact head.`;
  let effects = null;
  const outcome = reconcileManagedPullRequest(root, registered.managed.id, {
    now: 4000,
    snapshot: {
      number: 45,
      state: 'MERGED',
      mergedAt: '2026-08-09T01:02:00.000Z',
      headRefOid: head,
      headRefName: 'ai/issue-101',
      baseRefName: 'main',
      labels: [],
      comments: [{ id: 7788, body: marker, createdAt: '2026-08-09T01:01:30.000Z' }],
      reviews: [],
      statusCheckRollup: [],
      body: 'Fixes #101',
      closingIssuesReferences: [{ number: 101 }],
    },
    effectRunner(_root, _managedId, pending) {
      effects = pending;
      return [];
    },
  });
  assert.equal(outcome.state, 'merged');
  assert.equal(outcome.reviewVerified, true);
  assert.equal(effects.find((effect) => effect.type === 'verify-merged-issue').reviewVerified, true);

  const store = loadPrReviewStore(root);
  const managed = store.managedPullRequests[0];
  const reviewJob = store.reviewJobs.find((job) => job.id === claimed.id);
  assert.equal(managed.reviewState, 'merged');
  assert.equal(managed.lastCompletedReviewSha, head);
  assert.equal(managed.lastReviewCommentId, 7788);
  assert.equal(reviewJob.state, 'completed');
  assert.equal(reviewJob.result, 'approved');
  assert.equal(reviewJob.resultSourceId, 7788);
  const run = loadRun(root, 101);
  assert.ok(run.events.some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.commit === head
    && event.reviewRequestId === claimed.reviewRequestId));
});

test('merged snapshot does not treat changes-requested completion as approval evidence', (t) => {
  const root = repo(t);
  configureReviews(root);
  seedRun(root, { approved: false });
  const registered = registerManagedPullRequest(root, managedInput(), { now: 1000 });
  const claimed = claimNextReview(root, { now: 2500 });
  markReviewSubmitted(root, claimed.id, {
    submittedAt: new Date(3000).toISOString(),
    conversationUrl: 'https://chatgpt.com/c/review',
  });
  const marker = `<!-- paseo-review:v1\n${JSON.stringify({
    reviewRequestId: claimed.reviewRequestId,
    repository: 'owner/repo',
    pullRequestNumber: 45,
    issueNumber: 101,
    headSha: head,
    reviewRound: claimed.reviewRound,
    promptVersion: claimed.promptVersion,
    result: 'changes_requested',
  })}\n-->\nBlocking defect remains.`;
  const openSnapshot = {
    number: 45,
    state: 'OPEN',
    mergedAt: null,
    headRefOid: head,
    headRefName: 'ai/issue-101',
    baseRefName: 'main',
    labels: ['paseo:changes-requested'],
    comments: [{ id: 7788, body: marker, createdAt: '2026-08-09T01:01:30.000Z' }],
    reviews: [],
    statusCheckRollup: [],
    body: 'Fixes #101',
    closingIssuesReferences: [{ number: 101 }],
  };
  const rejected = reconcileManagedPullRequest(root, registered.managed.id, {
    now: 4000,
    snapshot: openSnapshot,
    effectRunner() { return []; },
  });
  assert.equal(rejected.review.result, 'changes_requested');
  let store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests[0].lastCompletedReviewSha, head);
  assert.equal(store.reviewJobs.find((job) => job.id === claimed.id).result, 'changes_requested');

  let effects = null;
  const merged = reconcileManagedPullRequest(root, registered.managed.id, {
    now: 5000,
    snapshot: {
      ...openSnapshot,
      state: 'MERGED',
      mergedAt: '2026-08-09T01:02:00.000Z',
    },
    effectRunner(_root, _managedId, pending) {
      effects = pending;
      return [];
    },
  });
  assert.equal(merged.state, 'merged');
  assert.equal(merged.reviewVerified, false);
  assert.equal(effects.find((effect) => effect.type === 'verify-merged-issue').reviewVerified, false);
  store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests[0].reviewEvidenceMissing, true);
});

test('merged records with pending lifecycle completion remain eligible after persistence', (t) => {
  const root = repo(t);
  configureReviews(root);
  registerManagedPullRequest(root, managedInput(), { now: 1000 });
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests[0];
    managed.reviewState = 'merged';
    managed.lastCompletedReviewSha = head;
    managed.issueClosurePending = false;
    managed.lifecycleCompletionPending = true;
    managed.reviewEvidenceMissing = false;
  });
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].lifecycleCompletionPending, true);

  let effectCalls = 0;
  const snapshot = {
    number: 45,
    state: 'MERGED',
    mergedAt: '2026-08-09T01:02:00.000Z',
    headRefOid: head,
    headRefName: 'ai/issue-101',
    baseRefName: 'main',
    labels: [], comments: [], reviews: [], statusCheckRollup: [],
    body: 'Fixes #101', closingIssuesReferences: [{ number: 101 }],
  };
  const first = reconcileManagedPullRequests(root, {
    now: 5000,
    snapshot,
    effectRunner() { effectCalls += 1; return []; },
  });
  assert.equal(first.checked, 1);
  assert.equal(effectCalls, 1);

  mutatePrReviewStore(root, (store) => {
    store.managedPullRequests[0].issueClosurePending = false;
    store.managedPullRequests[0].lifecycleCompletionPending = false;
  });
  const second = reconcileManagedPullRequests(root, {
    now: 6000,
    snapshot,
    effectRunner() { effectCalls += 1; return []; },
  });
  assert.equal(second.checked, 0);
  assert.equal(effectCalls, 1);
});
