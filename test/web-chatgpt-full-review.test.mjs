import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PASEO_LABELS } from '../src/label-catalog.mjs';
import { registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, mutatePrReviewStore } from '../src/pr-review-store.mjs';
import { reviewWorkerPath } from '../src/pr-review-scheduler.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';
import {
  WEB_CHATGPT_FULL_REVIEW_STAGE,
  fullReviewRound,
  pauseWebReviewsForExpiredProfile,
  queueWebChatGptFullReview,
  renderWebChatGptFullReviewPrompt,
  shouldQueueWebChatGptFullReview,
  webChatGptFullReviewDecision,
  webChatGptFullReviewMetadata,
} from '../src/web-chatgpt-full-review.mjs';
import { enforceWebChatGptFullReviewLimits } from '../src/web-chatgpt-full-review-reconcile.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-web-full-review-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registered = registerManagedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: 'https://github.com/octo/app/issues/7',
    pullRequestNumber: 11,
    pullRequestUrl: 'https://github.com/octo/app/pull/11',
    branchName: 'paseo/issue-7',
    currentHeadSha: 'abcdef1234567890',
  });
  return { root, managedId: registered.managed.id };
}

function config(fullMaxRounds = 3) {
  return { review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds } };
}

function quickPass() { return { action: 'quick-passed' }; }

function expected(round = 1) {
  return {
    repository: 'octo/app',
    pullRequestNumber: 11,
    issueNumber: 7,
    headSha: 'abcdef1234567890',
    stage: 'full',
    round,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
  };
}

function verdict(result, round = 1) {
  return {
    ...expected(round),
    result,
    summary: result === 'changes' ? 'Fix the edge case.' : 'Looks good.',
    findings: result === 'changes'
      ? [{ severity: 'blocking', message: 'Fix the edge case.', file: 'src/a.mjs', line: 4 }]
      : [],
  };
}

test('Web ChatGPT queues only after quick review passes or hands off on the selected workflow', () => {
  assert.equal(shouldQueueWebChatGptFullReview(config(), quickPass()), true);
  assert.equal(shouldQueueWebChatGptFullReview(config(), { action: 'handoff', target: WEB_CHATGPT_FULL_REVIEW_STAGE }), true);
  assert.equal(shouldQueueWebChatGptFullReview(config(), { action: 'repair' }), false);
  assert.equal(shouldQueueWebChatGptFullReview({ review: { workflow: 'quick-manual' } }, quickPass()), false);
});

test('full-review rounds are independent of any quick-review rounds', () => {
  const events = [
    { event: 'harness-review', stage: 'quick', result: 'changes', round: 1 },
    { event: 'harness-review', stage: 'quick', result: 'changes', round: 2 },
    { event: 'harness-review', stage: 'quick', result: 'pass', round: 3 },
  ];
  assert.equal(fullReviewRound(events), 1);
  events.push({ event: 'harness-review', stage: 'full', result: 'changes', round: 1 });
  assert.equal(fullReviewRound(events), 2);
});

test('queue metadata routes the existing machine-global serial scheduler to the full-review worker', (t) => {
  const { root, managedId } = repository(t);
  const queued = queueWebChatGptFullReview(root, managedId, {
    quickOutcome: quickPass(),
    quickFindings: [{ severity: 'blocking', message: 'Recheck parsing.', file: 'src/a.mjs' }],
    reviewEvents: [{ event: 'harness-review', stage: 'quick', result: 'pass', round: 1 }],
    config: config(3),
    now: Date.parse('2026-08-07T04:00:00Z'),
  });
  assert.equal(queued.queued, true);
  assert.equal(queued.metadata.stage, 'full');
  assert.equal(queued.metadata.headSha, 'abcdef1234567890');
  assert.equal(queued.metadata.stageRound, 1);
  assert.equal(queued.metadata.maxStageRounds, 3);
  assert.equal(webChatGptFullReviewMetadata(root, queued.job.id).quickFindings[0].message, 'Recheck parsing.');
  assert.match(reviewWorkerPath(root, queued.job.id), /web-chatgpt-full-review-worker\.mjs$/);
});

test('full-review prompt uses the versioned full contract and treats quick findings as untrusted context', (t) => {
  const { root, managedId } = repository(t);
  const queued = queueWebChatGptFullReview(root, managedId, {
    quickOutcome: quickPass(),
    quickFindings: [{ severity: 'blocking', message: 'Possible stale cache.', file: 'src/cache.mjs', line: 9 }],
    config: config(),
  });
  const store = loadPrReviewStore(root);
  const managed = store.managedPullRequests.find((item) => item.id === managedId);
  const job = store.reviewJobs.find((item) => item.id === queued.job.id);
  const prompt = renderWebChatGptFullReviewPrompt({ managed, job, metadata: queued.metadata });
  assert.match(prompt, /This is a FULL review/);
  assert.match(prompt, /Quick-review findings are handoff context only/);
  assert.match(prompt, /Possible stale cache/);
  assert.match(prompt, /Re-evaluate them independently/);
  assert.match(prompt, /"stage":"full"/);
  assert.match(prompt, /"round":1/);
  assert.match(prompt, /paseo-review:v1/);
  assert.match(prompt, /Never merge, close, or edit the PR/);
});

test('stale results are ignored and rescheduled for the current exact head', () => {
  assert.deepEqual(webChatGptFullReviewDecision({
    config: config(),
    reviewEvents: [],
    verdict: verdict('pass'),
    expected: expected(),
    currentHeadSha: 'deadbee1234567890',
  }), { action: 'stale', requeueCurrentHead: true });
});

test('full changes repair until the configured limit then stop automatic fixes and require attention', () => {
  assert.deepEqual(webChatGptFullReviewDecision({
    config: config(3),
    reviewEvents: [],
    verdict: verdict('changes', 1),
    expected: expected(1),
    currentHeadSha: expected().headSha,
  }), { action: 'repair', round: 1, limit: 3 });

  const events = [
    { event: 'harness-review', stage: 'full', result: 'changes', round: 1 },
    { event: 'harness-review', stage: 'full', result: 'changes', round: 2 },
  ];
  const decision = webChatGptFullReviewDecision({
    config: config(3),
    reviewEvents: events,
    verdict: verdict('changes', 3),
    expected: expected(3),
    currentHeadSha: expected().headSha,
  });
  assert.equal(decision.action, 'attention');
  assert.equal(decision.stopAutomaticFixes, true);
  assert.deepEqual(decision.issueLabels, [PASEO_LABELS.needsAttention]);
  assert.deepEqual(decision.pullRequestLabels, [PASEO_LABELS.changesRequested]);
});

test('runtime exhaustion cancels the generated fix job before another automatic repair can start', (t) => {
  const { root, managedId } = repository(t);
  const reviewEvents = [
    { event: 'harness-review', stage: 'full', result: 'changes', round: 1 },
    { event: 'harness-review', stage: 'full', result: 'changes', round: 2 },
  ];
  const queued = queueWebChatGptFullReview(root, managedId, {
    quickOutcome: quickPass(),
    reviewEvents,
    config: config(3),
  });
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests.find((item) => item.id === managedId);
    managed.reviewState = 'fix_queued';
    store.fixJobs.push({
      id: 'fix-limit',
      managedPullRequestId: managedId,
      reviewJobId: queued.job.id,
      reviewRequestId: queued.job.reviewRequestId,
      repository: 'octo/app',
      pullRequestNumber: 11,
      issueNumber: 7,
      branchName: 'paseo/issue-7',
      reviewedHeadSha: queued.job.headSha,
      findings: 'Still broken.',
      state: 'queued',
      priority: 0,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  const labels = [];
  const enforced = enforceWebChatGptFullReviewLimits(root, {
    applyLabels: (_root, managed) => labels.push(managed.issueNumber),
  });
  assert.equal(enforced.stopped.length, 1);
  assert.deepEqual(labels, [7]);
  const store = loadPrReviewStore(root);
  assert.equal(store.fixJobs.find((job) => job.id === 'fix-limit').state, 'cancelled');
  assert.equal(store.managedPullRequests.find((item) => item.id === managedId).reviewState, 'failed');
});

test('expired ChatGPT Profile pauses new submissions without failing active pull requests', () => {
  const store = {
    config: { reviewQueue: { paused: false } },
    reviewJobs: [{ id: 'a', state: 'queued', updatedAt: null, lastError: null }],
  };
  const result = pauseWebReviewsForExpiredProfile(store, { at: '2026-08-07T04:00:00Z', reason: 'Sign-in required.' });
  assert.deepEqual(result, { paused: true, failActivePullRequests: false, reason: 'Sign-in required.' });
  assert.equal(store.config.reviewQueue.paused, true);
  assert.equal(store.reviewJobs[0].state, 'queued');
  assert.equal(store.reviewJobs[0].lastError, 'Sign-in required.');
});
