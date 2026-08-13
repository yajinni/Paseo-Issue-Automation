import assert from 'node:assert/strict';
import test from 'node:test';
import { managerRepositoryAction } from '../src/manager-actions.mjs';
import { MANAGER_AUTOMATION_REVIEWS_SCRIPT } from '../src/manager-automation-reviews-ui.mjs';
import { managerPrReviewSummary } from '../src/manager-status.mjs';

test('manager exposes repository-scoped PR review queue pause and resume actions', () => {
  const calls = [];
  const actions = {
    setReviewQueuePaused(root, paused) {
      calls.push({ root, paused });
      return { reviewQueue: { paused } };
    },
  };

  assert.deepEqual(
    managerRepositoryAction('/repo-a', '/api/pr-review/pause', {}, actions),
    { reviewQueue: { paused: true } },
  );
  assert.deepEqual(
    managerRepositoryAction('/repo-a', '/api/pr-review/resume', {}, actions),
    { reviewQueue: { paused: false } },
  );
  assert.deepEqual(calls, [
    { root: '/repo-a', paused: true },
    { root: '/repo-a', paused: false },
  ]);
});

test('manager PR review summary exposes durable queue state without conflating it with worker state', () => {
  const summary = managerPrReviewSummary('/repo-a', {
    loadStore: () => ({
      config: {
        enabled: true,
        browserReview: { enabled: true },
         reviewQueue: { paused: true },
      },
      reviewJobs: [
        { id: 'queued-a', state: 'queued' },
        { id: 'submitting-a', state: 'submitting' },
        { id: 'queued-b', state: 'queued' },
      ],
      runtime: { activeReviewJobId: 'submitting-a' },
    }),
  });

   assert.deepEqual(summary, {
    available: true,
    enabled: false,
    browserReviewEnabled: true,
    queuePaused: true,
    waitingReviewCount: 2,
    activeReviewJobId: 'submitting-a',
  });
});

test('manager PR review summary fails closed when durable review state cannot be read', () => {
  const summary = managerPrReviewSummary('/repo-a', {
    loadStore: () => { throw new Error('corrupt review state'); },
  });

  assert.equal(summary.available, false);
  assert.equal(summary.queuePaused, true);
  assert.equal(summary.waitingReviewCount, 0);
  assert.match(summary.error, /corrupt review state/);
});

test('PR Reviews UI shows queue state and lifecycle controls without separate worker toggles', () => {
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /Review queue/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /Scheduler result/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /lastReviewResult/);
  assert.doesNotMatch(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /review-worker\/(start|stop|restart)/);
});
