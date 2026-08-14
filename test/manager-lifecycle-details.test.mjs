import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  managerLifecycleDetails,
  managerLifecycleDetailsApiRequest,
} from '../src/manager-lifecycle-details.mjs';

function issueRunner(_command, args) {
  assert.deepEqual(args.slice(0, 3), ['issue', 'view', '274']);
  assert.match(args.at(-1), /createdAt/);
  assert.match(args.at(-1), /closedAt/);
  return {
    number: 274,
    title: 'Reconcile accepted OpenSpec and rewrite status',
    url: 'https://github.com/yajinni/JuliesDashboard/issues/274',
    state: 'CLOSED',
    createdAt: '2026-08-07T21:34:00.000Z',
    closedAt: '2026-08-08T01:06:00.000Z',
  };
}

const run = {
  issueNumber: 274,
  issueTitle: 'Reconcile accepted OpenSpec and rewrite status',
  issueUrl: 'https://github.com/yajinni/JuliesDashboard/issues/274',
  phase: 'completed',
  status: 'Completed',
  branch: 'ai/issue-274-reconcile',
  workspaceId: 'workspace-274',
  coderAgentId: 'coder-274',
  coderModel: 'opencode/openai/gpt-5.6-luna-family',
  coderThinking: 'high',
  codingHarness: 'opencode',
  startedAt: '2026-08-07T23:02:00.000Z',
  updatedAt: '2026-08-08T01:06:00.000Z',
  completedAt: '2026-08-08T01:06:00.000Z',
  prNumber: 383,
  prUrl: 'https://github.com/yajinni/JuliesDashboard/pull/383',
  mergedAt: '2026-08-08T01:05:00.000Z',
  mergedHeadSha: 'merged-head-274',
  issueClosureVerifiedAt: '2026-08-08T01:06:00.000Z',
  reviewRuntimeStage: 'full-web-chatgpt',
  events: [
    {
      event: 'harness-review',
      stage: 'quick',
      round: 1,
      result: 'pass',
      headSha: 'quick-head',
      summary: 'Quick review passed.',
      findings: [],
      at: '2026-08-08T00:12:00.000Z',
    },
    {
      event: 'review',
      stage: 'full',
      round: 1,
      result: 'APPROVED',
      headSha: 'web-head',
      source: 'browser-review',
      conversationUrl: 'https://chatgpt.com/c/review-274',
      summary: 'Browser review passed.',
      findings: [{ severity: 'non-blocking', message: 'Small naming note.' }],
      at: '2026-08-08T00:42:00.000Z',
    },
  ],
};

const lifecycle = [
  { type: 'run-created', at: '2026-08-07T23:02:00.000Z' },
  { type: 'agent-started', at: '2026-08-07T23:15:00.000Z' },
  { type: 'pr-review-queued', at: '2026-08-07T23:45:00.000Z' },
];

const config = {
  baseBranch: 'main',
  codingHarness: 'opencode',
  review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 4 },
  models: {
    coder: 'opencode/openai/gpt-5.6-luna-family',
    coderThinking: 'high',
    reviewer: 'opencode/openai/gpt-5.6-luna-family',
    reviewerThinking: 'high',
  },
};

test('lifecycle details expose real issue-created and Paseo-claimed timestamps without time-before-claim', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => run,
    lifecycleLoader: () => lifecycle,
    configLoader: () => config,
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });

  assert.equal(details.claimed.issueCreatedAt, '2026-08-07T21:34:00.000Z');
  assert.equal(details.claimed.claimedAt, '2026-08-07T23:02:00.000Z');
  assert.equal(details.claimed.claimedBy, 'Paseo Automation');
  assert.match(details.claimed.explanation, /selected this issue for processing/i);
  assert.match(details.claimed.explanation, /queue to be passed to a coding agent/i);
  assert.equal(Object.hasOwn(details.claimed, 'timeBeforeClaim'), false);
});

test('lifecycle details separate coding from configured review stages and preserve recorded review evidence', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => run,
    lifecycleLoader: () => lifecycle,
    configLoader: () => config,
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });

  assert.equal(details.coding.startedAt, '2026-08-07T23:15:00.000Z');
  assert.equal(details.coding.completedAt, '2026-08-07T23:45:00.000Z');
  assert.equal(details.coding.model, 'opencode/openai/gpt-5.6-luna-family');

  assert.deepEqual(details.reviews.map((review) => review.type), ['light', 'chatgpt']);
  const light = details.reviews[0];
  assert.equal(light.label, 'Light Review');
  assert.equal(light.performed, true);
  assert.equal(light.result, 'Passed');
  assert.equal(light.completedAt, '2026-08-08T00:12:00.000Z');

  const chatgpt = details.reviews[1];
  assert.equal(chatgpt.label, 'ChatGPT Review');
  assert.equal(chatgpt.model, null);
  assert.equal(chatgpt.thinking, null);
  assert.equal(chatgpt.conversationUrl, 'https://chatgpt.com/c/review-274');
  assert.equal(chatgpt.result, 'Passed');
  assert.equal(chatgpt.findingCounts.nonBlocking, 1);
});

test('full-immediate configuration exposes Heavy PR Review even before a review result exists', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => ({ ...run, events: [], reviewRuntimeStage: null }),
    lifecycleLoader: () => lifecycle,
    configLoader: () => ({
      ...config,
      review: { workflow: 'full-immediate', quickMaxRounds: 3, fullMaxRounds: 5 },
    }),
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });

  assert.deepEqual(details.reviews.map((review) => review.type), ['heavy']);
  assert.equal(details.reviews[0].label, 'Heavy PR Review');
  assert.equal(details.reviews[0].configured, true);
  assert.equal(details.reviews[0].performed, false);
  assert.equal(details.reviews[0].limit, 5);
});

test('completion details consolidate merge, issue closure, and final lifecycle completion facts', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => run,
    lifecycleLoader: () => lifecycle,
    configLoader: () => config,
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });

  assert.equal(details.completed.prNumber, 383);
  assert.equal(details.completed.mergedAt, '2026-08-08T01:05:00.000Z');
  assert.equal(details.completed.issueClosedAt, '2026-08-08T01:06:00.000Z');
  assert.equal(details.completed.issueClosureVerifiedAt, '2026-08-08T01:06:00.000Z');
  assert.equal(details.completed.completedAt, '2026-08-08T01:06:00.000Z');
  assert.equal(details.completed.complete, true);
});

test('lifecycle-details API route is read-only and returns one issue projection', () => {
  const response = managerLifecycleDetailsApiRequest(
    { method: 'GET', pathname: '/api/issues/274/lifecycle-details' },
    { root: '/repo' },
    { lifecycleDetailsReader: (_root, issueNumber) => ({ issueNumber, ok: true }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lifecycleDetails, { issueNumber: 274, ok: true });

  const rejected = managerLifecycleDetailsApiRequest(
    { method: 'POST', pathname: '/api/issues/274/lifecycle-details' },
    { root: '/repo' },
  );
  assert.equal(rejected.status, 405);
});

test('terminal launch failure is Failed and cannot become successful Completed from completedAt alone', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => ({ ...run, status: 'paseo:failed', phase: 'launch-failed', reason: 'Workspace creation failed.', completedAt: run.completedAt }),
    lifecycleLoader: () => lifecycle,
    configLoader: () => config,
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });
  assert.equal(details.coding.status, 'Failed');
  assert.equal(details.coding.failureReason, 'Workspace creation failed.');
  assert.equal(details.completed.complete, false);
});

test('lifecycle diagnostics expose prompts from prior attempts', () => {
  const details = managerLifecycleDetails('/repo', 274, {
    jsonRunner: issueRunner,
    runLoader: () => ({
      ...run,
      history: [{ attempt: 1, coderPrompts: [{ attempt: 1, kind: 'initial-attempt', prompt: 'prior attempt prompt' }] }],
      coderPrompts: [{ attempt: 2, kind: 'initial-attempt', prompt: 'current attempt prompt' }],
    }),
    lifecycleLoader: () => lifecycle,
    configLoader: () => config,
    reviewStoreLoader: () => ({ managedPullRequests: [], reviewJobs: [] }),
  });
  assert.deepEqual(details.diagnostics.coderPrompts.map((prompt) => prompt.prompt), [
    'prior attempt prompt',
    'current attempt prompt',
  ]);
});

test('manager API composes the lifecycle-details route before generic repository GET handling', () => {
  const source = readFileSync(new URL('../src/manager-api.mjs', import.meta.url), 'utf8');
  assert.match(source, /managerLifecycleDetailsApiRequest/);
  assert.match(source, /pathname: context\.pathname/);
  assert.match(source, /if \(lifecycleDetails\) return lifecycleDetails/);
});
