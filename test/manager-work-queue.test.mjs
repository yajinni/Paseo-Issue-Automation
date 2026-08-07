import assert from 'node:assert/strict';
import test from 'node:test';
import { PASEO_LABELS } from '../src/label-catalog.mjs';
import {
  managerWorkQueue,
  managerWorkQueueItem,
} from '../src/manager-work-queue.mjs';

test('work queue exposes current lifecycle state and useful issue/PR identity', () => {
  const item = managerWorkQueueItem({
    issueNumber: 42,
    issueTitle: 'Improve manager UX',
    issueUrl: 'https://github.com/example/repo/issues/42',
    status: PASEO_LABELS.coding,
    phase: 'coding',
    branch: 'ai/issue-42-manager-ux',
    attempt: 2,
    workspaceId: 'workspace-42',
    pullRequestNumber: 77,
    pullRequestUrl: 'https://github.com/example/repo/pull/77',
    startedAt: '2026-08-07T09:00:00.000Z',
    updatedAt: '2026-08-07T09:05:00.000Z',
  });

  assert.equal(item.issueNumber, 42);
  assert.equal(item.title, 'Improve manager UX');
  assert.equal(item.stage, 'coding');
  assert.equal(item.stageLabel, 'Coding');
  assert.equal(item.lifecycleLabel, PASEO_LABELS.coding);
  assert.deepEqual(item.pullRequest, { number: 77, url: 'https://github.com/example/repo/pull/77' });
  assert.equal(item.branch, 'ai/issue-42-manager-ux');
  assert.equal(item.attempt, 2);
});

test('native dependency waits are shown as waiting without inventing a blocked lifecycle label', () => {
  const item = managerWorkQueueItem({
    issueNumber: 4,
    issueTitle: 'Depends on another issue',
    phase: 'waiting-for-dependencies',
    reason: 'Issue #4 is blocked by open issue #2.',
  });

  assert.equal(item.stage, 'waiting');
  assert.equal(item.stageLabel, 'Waiting for dependencies');
  assert.equal(item.waitingForDependencies, true);
  assert.equal(item.lifecycleLabel, null);
  assert.match(item.nextAction, /blocked by open issue #2/i);
});

test('issue body prose does not create dependency state', () => {
  const item = managerWorkQueueItem({
    issueNumber: 5,
    issue: { title: 'Body mentions another task', body: 'Blocked by #2 and depends on #3.' },
  });
  assert.equal(item.waitingForDependencies, false);
  assert.equal(item.stage, 'unknown');
});

test('legacy stored labels normalize to current lifecycle names without exposing legacy labels', () => {
  const item = managerWorkQueueItem({ issueNumber: 6, status: 'agent-running' });
  assert.equal(item.lifecycleLabel, PASEO_LABELS.coding);
  assert.equal(item.stage, 'coding');
  assert.doesNotMatch(item.lifecycleLabel, /^agent-/);
});

test('review detail preserves exact-head, stage, round, validation, and approval identity', () => {
  const item = managerWorkQueueItem({
    issueNumber: 9,
    status: PASEO_LABELS.reviewing,
    phase: 'reviewing',
    currentHeadSha: 'abc123current',
    validationApproved: true,
    validationHeadSha: 'abc123current',
    reviewApproved: false,
    events: [{
      event: 'harness-review',
      stage: 'quick',
      round: 2,
      result: 'changes',
      headSha: 'abc123current',
      summary: 'One blocking issue.',
      at: '2026-08-07T09:10:00.000Z',
    }],
  }, { review: { quickMaxRounds: 3, fullMaxRounds: 4 } });

  assert.equal(item.review.stage, 'quick');
  assert.equal(item.review.round, 2);
  assert.equal(item.review.limit, 3);
  assert.equal(item.review.result, 'changes');
  assert.equal(item.review.headSha, 'abc123current');
  assert.equal(item.review.validationApproved, true);
  assert.equal(item.review.validationHeadSha, 'abc123current');
  assert.equal(item.review.reviewApproved, false);
});

test('queue timeline combines recorded activity, review events, and prior attempts newest first', () => {
  const item = managerWorkQueueItem({
    issueNumber: 10,
    activity: [{ type: 'agent-started', at: '2026-08-07T09:00:00.000Z', details: 'Coder started.' }],
    events: [{ event: 'harness-review', stage: 'quick', round: 1, result: 'pass', headSha: 'head1', at: '2026-08-07T09:20:00.000Z' }],
    history: [{ attempt: 1, branch: 'ai/old', status: PASEO_LABELS.failed, startedAt: '2026-08-07T08:00:00.000Z', completedAt: '2026-08-07T08:30:00.000Z' }],
  });

  assert.equal(item.timeline.length, 3);
  assert.equal(item.timeline[0].type, 'harness-review');
  assert.match(item.timeline[0].detail, /quick.*round 1.*pass.*head head1/i);
  assert.equal(item.timeline[1].type, 'agent-started');
  assert.equal(item.timeline[2].type, 'attempt-history');
});

test('queue is issue-number ordered and reports stage/attention counts', () => {
  const queue = managerWorkQueue([
    { issueNumber: 12, status: PASEO_LABELS.failed },
    { issueNumber: 2, status: PASEO_LABELS.coding },
    { issueNumber: 7, phase: 'waiting-for-dependencies' },
  ]);
  assert.deepEqual(queue.items.map((item) => item.issueNumber), [2, 7, 12]);
  assert.equal(queue.counts.coding, 1);
  assert.equal(queue.counts.waiting, 1);
  assert.equal(queue.counts.failed, 1);
  assert.equal(queue.attention, 1);
  assert.equal(queue.total, 3);
});
