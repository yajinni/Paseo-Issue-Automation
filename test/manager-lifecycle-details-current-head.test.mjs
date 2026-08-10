import assert from 'node:assert/strict';
import test from 'node:test';
import { managerLifecycleDetails } from '../src/manager-lifecycle-details.mjs';

const config = {
  baseBranch: 'main',
  codingHarness: 'opencode',
  review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 4 },
  models: {
    reviewer: 'opencode/openai/gpt-5.6-luna-family',
    reviewerThinking: 'high',
  },
};

function issueRunner() {
  return {
    number: 274,
    title: 'Example issue',
    url: 'https://github.com/yajinni/JuliesDashboard/issues/274',
    state: 'OPEN',
    createdAt: '2026-08-07T21:34:00.000Z',
    closedAt: null,
  };
}

test('current review evidence replaces stale results from a previous PR head', () => {
  const run = {
    issueNumber: 274,
    issueTitle: 'Example issue',
    phase: 'reviewing',
    status: 'Reviewing',
    startedAt: '2026-08-07T23:02:00.000Z',
    updatedAt: '2026-08-08T00:50:00.000Z',
    prNumber: 383,
    reviewRuntimeStage: 'full-web-chatgpt',
    events: [
      {
        event: 'review',
        stage: 'full',
        round: 1,
        result: 'changes_requested',
        headSha: 'old-head',
        source: 'browser-review',
        conversationUrl: 'https://chatgpt.com/c/old-review',
        summary: 'The old head needs changes.',
        findings: [
          {
            severity: 'blocking',
            message: 'Fix the old implementation.',
            file: 'src/old.mjs',
            line: 42,
          },
        ],
        at: '2026-08-08T00:42:00.000Z',
      },
    ],
  };

  const store = {
    managedPullRequests: [
      {
        id: 'managed-383',
        issueNumber: 274,
        pullRequestNumber: 383,
        currentHeadSha: 'new-head',
        reviewRound: 2,
        activeReviewRequestId: 'request-2',
        lastActivityAt: '2026-08-08T00:50:00.000Z',
      },
    ],
    reviewJobs: [
      {
        id: 'job-2',
        managedPullRequestId: 'managed-383',
        headSha: 'new-head',
        reviewRound: 2,
        state: 'queued',
        createdAt: '2026-08-08T00:50:00.000Z',
        reviewRequestId: 'request-2',
        conversationUrlOverride: 'https://chatgpt.com/c/new-review',
        attempts: 0,
      },
    ],
  };

  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => run,
    lifecycleLoader: () => [{ type: 'run-created', at: '2026-08-07T23:02:00.000Z' }],
    configLoader: () => config,
    reviewStoreLoader: () => store,
  });

  const chatgpt = details.reviews.find((review) => review.type === 'chatgpt');
  assert.ok(chatgpt);
  assert.equal(chatgpt.exactHeadSha, 'new-head');
  assert.equal(chatgpt.round, 2);
  assert.equal(chatgpt.performed, false);
  assert.equal(chatgpt.result, null);
  assert.equal(chatgpt.completedAt, null);
  assert.equal(chatgpt.summary, null);
  assert.deepEqual(chatgpt.findings, []);
  assert.deepEqual(chatgpt.findingCounts, { blocking: 0, nonBlocking: 0, total: 0 });
  assert.equal(chatgpt.conversationUrl, 'https://chatgpt.com/c/new-review');
  assert.equal(chatgpt.reviewJobId, 'job-2');
  assert.equal(chatgpt.reviewRequestId, 'request-2');
});
