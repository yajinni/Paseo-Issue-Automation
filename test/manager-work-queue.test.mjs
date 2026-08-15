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

test('ready and queued lifecycle stages use the user-facing Available and Claimed names', () => {
  const available = managerWorkQueueItem({ issueNumber: 1, status: PASEO_LABELS.ready, phase: 'ready' });
  const claimed = managerWorkQueueItem({ issueNumber: 2, status: PASEO_LABELS.queued, phase: 'queued' });
  assert.equal(available.stage, 'ready');
  assert.equal(available.stageLabel, 'Available');
  assert.match(available.nextAction, /available/i);
  assert.equal(claimed.stage, 'queued');
  assert.equal(claimed.stageLabel, 'Claimed');
  assert.match(claimed.nextAction, /claimed/i);
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

test('coding detail exposes configured model thinking level and harness', () => {
  const item = managerWorkQueueItem({ issueNumber: 8, phase: 'coding' }, {
    codingHarness: 'opencode',
    models: { coder: 'openai/gpt-5.5', coderThinking: 'high' },
  });
  assert.deepEqual(item.coding, {
    model: 'openai/gpt-5.5',
    thinking: 'high',
    harness: 'opencode',
  });
});

test('recorded coding identity wins over later configuration changes when present', () => {
  const item = managerWorkQueueItem({
    issueNumber: 81,
    phase: 'coding',
    coderModel: 'openai/gpt-5.5',
    coderThinking: 'high',
    codingHarness: 'opencode',
  }, {
    codingHarness: 'different-harness',
    models: { coder: 'other/model', coderThinking: 'low' },
  });
  assert.equal(item.coding.model, 'openai/gpt-5.5');
  assert.equal(item.coding.thinking, 'high');
  assert.equal(item.coding.harness, 'opencode');
});

test('quick harness review is presented as Light review with model and thinking', () => {
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
  }, {
    review: { workflow: 'quick-manual', quickMaxRounds: 3, fullMaxRounds: 4 },
    models: { reviewer: 'openai/gpt-5.5-mini', reviewerThinking: 'medium' },
  });

  assert.equal(item.review.type, 'light');
  assert.equal(item.review.label, 'Light review');
  assert.equal(item.review.model, 'openai/gpt-5.5-mini');
  assert.equal(item.review.thinking, 'medium');
  assert.equal(item.review.stage, 'quick');
  assert.equal(item.review.round, 2);
  assert.equal(item.review.limit, 3);
  assert.equal(item.review.result, 'changes');
  assert.equal(item.review.headSha, 'abc123current');
  assert.equal(item.review.validationApproved, true);
  assert.equal(item.review.validationHeadSha, 'abc123current');
  assert.equal(item.review.reviewApproved, false);
});

test('full-immediate harness review is presented as Heavy review', () => {
  const item = managerWorkQueueItem({
    issueNumber: 10,
    phase: 'reviewing',
    events: [{ event: 'harness-review', stage: 'full', round: 1, result: 'pass', headSha: 'head-heavy', at: '2026-08-07T10:00:00.000Z' }],
  }, {
    review: { workflow: 'full-immediate', quickMaxRounds: 3, fullMaxRounds: 4 },
    models: { reviewer: 'openai/gpt-5.5', reviewerThinking: 'high' },
  });
  assert.equal(item.review.type, 'heavy');
  assert.equal(item.review.label, 'Heavy review');
  assert.equal(item.review.model, 'openai/gpt-5.5');
  assert.equal(item.review.thinking, 'high');
  assert.equal(item.review.limit, 4);
});

test('Web ChatGPT full review is distinct and never invents model or thinking identity', () => {
  const item = managerWorkQueueItem({
    issueNumber: 11,
    phase: 'reviewing',
    events: [{
      event: 'review',
      stage: 'full',
      round: 2,
      result: 'APPROVED',
      headSha: 'web-head',
      source: 'browser-review',
      conversationUrl: 'https://chatgpt.com/c/review-11',
      at: '2026-08-07T11:00:00.000Z',
    }],
  }, {
    review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 5 },
    models: { reviewer: 'openai/gpt-5.5', reviewerThinking: 'high' },
  });
  assert.equal(item.review.type, 'web-chatgpt');
  assert.equal(item.review.label, 'Web ChatGPT review');
  assert.equal(item.review.channel, 'Browser conversation');
  assert.equal(item.review.conversationUrl, 'https://chatgpt.com/c/review-11');
  assert.equal(item.review.model, null);
  assert.equal(item.review.thinking, null);
});

test('review-queued stage exposes its configured upcoming review method before a result exists', () => {
  const item = managerWorkQueueItem({
    issueNumber: 12,
    status: PASEO_LABELS.reviewQueued,
    phase: 'review-queued',
  }, {
    review: { workflow: 'full-immediate', quickMaxRounds: 3, fullMaxRounds: 4 },
    models: { reviewer: 'openai/gpt-5.5', reviewerThinking: 'high' },
  });
  assert.equal(item.review.label, 'Heavy review');
  assert.equal(item.review.model, 'openai/gpt-5.5');
});

test('queue timeline combines recorded activity, review events, and prior attempts newest first', () => {
  const item = managerWorkQueueItem({
    issueNumber: 13,
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

test('append-only lifecycle timeline preserves operator evidence for the activity view', () => {
  const item = managerWorkQueueItem({
    issueNumber: 14,
    lifecycle: [{
      id: 'event-1',
      at: '2026-08-07T12:00:00.000Z',
      type: 'operator-action',
      source: 'operator',
      status: 'success',
      message: 'Skip issue completed.',
      evidence: { action: 'skip-issue' },
    }],
  });
  assert.equal(item.timeline[0].type, 'operator-action');
  assert.equal(item.timeline[0].source, 'operator');
  assert.match(item.timeline[0].detail, /Skip issue completed/);
  assert.equal(item.timeline[0].evidence.action, 'skip-issue');
});

test('activity timeline omits low-level run-state changes while retaining meaningful lifecycle evidence', () => {
  const item = managerWorkQueueItem({
    issueNumber: 15,
    lifecycle: [
      { at: '2026-08-07T12:00:00.000Z', type: 'run-state-changed', source: 'state', message: 'low-level state delta' },
      { at: '2026-08-07T12:01:00.000Z', type: 'agent-started', source: 'activity', message: 'Coder started.' },
    ],
  });
  assert.deepEqual(item.timeline.map((event) => event.type), ['agent-started']);
});

test('activity and review evidence remain visible when an append-only lifecycle exists', () => {
  const item = managerWorkQueueItem({
    issueNumber: 151,
    lifecycle: [{
      at: '2026-08-07T12:02:00.000Z',
      type: 'operator-action',
      source: 'operator',
      message: 'Review paused by operator.',
    }],
    activity: [{ type: 'agent-started', at: '2026-08-07T12:00:00.000Z', details: 'Coder started.' }],
    events: [{ event: 'harness-review', stage: 'quick', result: 'pass', headSha: 'head1', at: '2026-08-07T12:01:00.000Z' }],
  });
  assert.deepEqual(item.timeline.map((event) => event.type), ['operator-action']);
  assert.deepEqual(item.legacyTimeline.map((event) => event.type), ['harness-review', 'agent-started']);
});

test('abandoned attempts remain visible as abandoned and are not active or completed', () => {
  const queue = managerWorkQueue([{
    issueNumber: 16,
    status: 'abandoned',
    phase: 'abandoned',
    completedAt: '2026-08-07T12:00:00.000Z',
  }]);
  assert.equal(queue.items[0].stage, 'abandoned');
  assert.equal(queue.items[0].stageLabel, 'Abandoned');
  assert.match(queue.items[0].nextAction, /abandoned/i);
  assert.equal(queue.active, 0);
  assert.equal(queue.attention, 1);
});

test('lifecycle-only completed skipped evidence stays visible but is historical and inactive', () => {
  const queue = managerWorkQueue([{
    issueNumber: 294,
    issueTitle: 'Completed skipped issue',
    issue: { state: 'CLOSED', stateReason: 'COMPLETED' },
    lifecycle: [{
      at: '2026-08-13T02:15:57.309Z',
      type: 'operator-action',
      source: 'operator',
      status: 'success',
      message: 'Skip issue completed.',
      evidence: { action: 'skip-issue' },
    }],
  }]);

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].stage, 'unknown');
  assert.equal(queue.items[0].active, false);
  assert.equal(queue.items[0].timeline[0].type, 'operator-action');
  assert.equal(queue.active, 0);
});

test('closed lifecycle-only history remains inactive without a live managed resource', () => {
  const queue = managerWorkQueue([{
    issueNumber: 295,
    issue: { state: 'CLOSED', stateReason: 'COMPLETED' },
    lifecycle: [{
      at: '2026-08-13T02:15:57.309Z',
      type: 'operator-action',
      source: 'operator',
      status: 'success',
      message: 'Skip issue completed.',
    }],
  }]);

  assert.equal(queue.items[0].active, false);
  assert.equal(queue.items[0].timeline.length, 1);
  assert.equal(queue.active, 0);
});

test('terminal failed and blocked history is inactive even when stale identifiers remain', () => {
  const queue = managerWorkQueue([
    {
      issueNumber: 296,
      status: PASEO_LABELS.failed,
      phase: 'failed',
      branch: 'ai/issue-296',
      workspaceId: 'old-workspace-296',
      completedAt: '2026-08-13T03:00:00.000Z',
    },
    {
      issueNumber: 297,
      status: PASEO_LABELS.needsAttention,
      phase: 'blocked',
      branch: 'ai/issue-297',
      workspaceId: 'old-workspace-297',
      completedAt: '2026-08-13T03:01:00.000Z',
    },
    {
      issueNumber: 298,
      phase: 'blocked',
      workspaceId: 'old-workspace-298',
      completedAt: '2026-08-13T03:02:00.000Z',
    },
  ]);

  assert.deepEqual(queue.items.map((item) => item.active), [false, false, false]);
  assert.equal(queue.active, 0);
});

test('terminal history can remain active only with a live controller or review job signal', () => {
  const queue = managerWorkQueue([{
    issueNumber: 299,
    status: PASEO_LABELS.failed,
    phase: 'failed',
    completedAt: '2026-08-13T03:03:00.000Z',
    controllerPid: 299,
  }]);

  assert.equal(queue.items[0].active, true);
  assert.equal(queue.active, 1);
});

test('unknown execution metadata remains active when live managed resources are recorded', () => {
  const queue = managerWorkQueue([{
    issueNumber: 300,
    workspaceId: 'workspace-300',
    coderAgentId: 'agent-300',
    controllerPid: 300,
  }]);

  assert.equal(queue.items[0].stage, 'unknown');
  assert.equal(queue.items[0].active, true);
  assert.equal(queue.active, 1);
});

test('workspace creation phase remains active before workspace identity is recorded', () => {
  const queue = managerWorkQueue([{
    issueNumber: 303,
    phase: 'creating-workspace',
    branch: 'ai/issue-303',
    startedAt: '2026-08-13T03:04:30.000Z',
  }]);

  assert.equal(queue.items[0].active, true);
  assert.equal(queue.active, 1);
});

test('historical lifecycle evidence remains visible after active exclusion', () => {
  const queue = managerWorkQueue([{
    issueNumber: 301,
    lifecycle: [{
      at: '2026-08-13T03:04:00.000Z',
      type: 'operator-action',
      source: 'operator',
      status: 'success',
      message: 'Issue skipped.',
    }],
  }]);

  assert.equal(queue.active, 0);
  assert.equal(queue.total, 1);
  assert.match(queue.items[0].timeline[0].detail, /Issue skipped/);
});

test('unknown execution metadata stays active for a queued review job', () => {
  const item = managerWorkQueueItem({ issueNumber: 302 }, {}, {
    managedPullRequests: [{ id: 'managed-302', issueNumber: 302 }],
    reviewJobs: [{ id: 'review-302', managedPullRequestId: 'managed-302', state: 'submitting' }],
    fixJobs: [],
  });

  assert.equal(item.stage, 'unknown');
  assert.equal(item.active, true);
});

test('prior-attempt coder prompts are included in deep diagnostics', () => {
  const item = managerWorkQueueItem({
    issueNumber: 17,
    history: [{ attempt: 1, coderPrompts: [{ kind: 'initial-attempt', prompt: 'prior prompt' }] }],
    coderPrompts: [{ attempt: 2, kind: 'initial-attempt', prompt: 'current prompt' }],
  });
  assert.deepEqual(item.diagnostics.coderPrompts.map((prompt) => prompt.prompt), ['prior prompt', 'current prompt']);
});

test('merged and issue-closure-verified phases remain visible before terminal completion', () => {
  const merged = managerWorkQueueItem({ issueNumber: 20, phase: 'merged', mergedAt: '2026-08-09T04:00:00.000Z' });
  const verified = managerWorkQueueItem({ issueNumber: 21, phase: 'issue-closure-verified', issueClosureVerifiedAt: '2026-08-09T04:01:00.000Z' });
  assert.equal(merged.stage, 'merged');
  assert.equal(merged.stageLabel, 'Merged');
  assert.equal(verified.stage, 'closure-verified');
  assert.equal(verified.stageLabel, 'Issue Closure Verified');
});

test('deep troubleshooting diagnostics expose recorded execution and exact-head identity', () => {
  const item = managerWorkQueueItem({
    issueNumber: 22,
    phase: 'reviewing',
    status: PASEO_LABELS.reviewing,
    worktreePath: '/tmp/worktree',
    workspaceId: 'workspace-22',
    coderAgentId: 'agent-22',
    controllerPid: 4321,
    heartbeatAt: '2026-08-09T04:01:00.000Z',
    currentHeadSha: 'head-current',
    validationHeadSha: 'head-validation',
    approvedHeadSha: 'head-approved',
    mergedHeadSha: 'head-merged',
  });
  assert.equal(item.diagnostics.rawStatus, PASEO_LABELS.reviewing);
  assert.equal(item.diagnostics.phase, 'reviewing');
  assert.equal(item.diagnostics.worktreePath, '/tmp/worktree');
  assert.equal(item.diagnostics.coderAgentId, 'agent-22');
  assert.equal(item.diagnostics.controllerPid, 4321);
  assert.equal(item.diagnostics.currentHeadSha, 'head-current');
  assert.equal(item.diagnostics.validationHeadSha, 'head-validation');
  assert.equal(item.diagnostics.approvedHeadSha, 'head-approved');
  assert.equal(item.diagnostics.mergedHeadSha, 'head-merged');
});

test('deep troubleshooting preserves launch base and exact coder prompt evidence', () => {
  const item = managerWorkQueueItem({
    issueNumber: 23,
    phase: 'launch-failed',
    status: PASEO_LABELS.failed,
    baseBranch: 'openspec',
    baseSha: 'a'.repeat(40),
    baseRef: 'refs/remotes/origin/openspec',
    baseVerifiedAt: '2026-08-09T04:00:00.000Z',
    coderPrompt: 'exact prompt for attempt 1',
    coderPromptRecordedAt: '2026-08-09T04:00:01.000Z',
    coderPromptKind: 'initial-attempt',
  });
  assert.equal(item.diagnostics.baseBranch, 'openspec');
  assert.equal(item.diagnostics.baseSha, 'a'.repeat(40));
  assert.equal(item.diagnostics.coderPrompt, 'exact prompt for attempt 1');
});

test('newest meaningful activity sorts the work queue first with issue-number tie breaking', () => {
  const queue = managerWorkQueue([
    { issueNumber: 12, updatedAt: '2026-08-10T10:00:00.000Z' },
    { issueNumber: 2, activity: [{ type: 'launch-failed', at: '2026-08-11T10:00:00.000Z', details: 'failed' }] },
    { issueNumber: 7, updatedAt: '2026-08-11T10:00:00.000Z' },
  ]);
  assert.deepEqual(queue.items.map((item) => item.issueNumber), [2, 7, 12]);
});

test('deep troubleshooting joins the matching PR automation store record and latest jobs', () => {
  const store = {
    managedPullRequests: [{
      id: 'managed-44',
      issueNumber: 44,
      pullRequestNumber: 144,
      branchName: 'ai/issue-44',
      currentHeadSha: 'head-current',
      lastSubmittedReviewSha: 'head-submitted',
      lastCompletedReviewSha: 'head-completed',
      reviewRound: 3,
      reviewState: 'changes_requested',
      queuePosition: null,
      activeReviewRequestId: 'request-active',
      lastReviewCommentId: 991,
      lastProcessedReviewRequestId: 'request-previous',
      lastReconciledAt: '2026-08-09T13:00:00.000Z',
      lastActivityAt: '2026-08-09T13:01:00.000Z',
      lastError: 'stored mismatch',
      issueClosurePending: true,
      lifecycleCompletionPending: false,
      reviewEvidenceMissing: true,
      updatedAt: '2026-08-09T13:01:00.000Z',
    }],
    reviewJobs: [{
      id: 'review-44-3',
      managedPullRequestId: 'managed-44',
      state: 'completed',
      headSha: 'head-current',
      reviewRound: 3,
      reviewRequestId: 'request-active',
      queuePosition: 7,
      attempts: 2,
      conversationUrlUsed: 'https://chatgpt.com/c/44',
      lastError: null,
      updatedAt: '2026-08-09T13:02:00.000Z',
    }],
    fixJobs: [{
      id: 'fix-44-3',
      managedPullRequestId: 'managed-44',
      state: 'fixing',
      reviewRequestId: 'request-active',
      reviewedHeadSha: 'head-current',
      coderAgentId: 'fix-agent',
      attempts: 1,
      updatedAt: '2026-08-09T13:03:00.000Z',
    }],
  };
  const item = managerWorkQueueItem({ issueNumber: 44, phase: 'fixing', prNumber: 144 }, {}, store);
  assert.equal(item.reviewAutomation.managedId, 'managed-44');
  assert.equal(item.reviewAutomation.reviewState, 'changes_requested');
  assert.equal(item.reviewAutomation.queuePosition, null);
  assert.equal(item.reviewAutomation.currentHeadSha, 'head-current');
  assert.equal(item.reviewAutomation.lastError, 'stored mismatch');
  assert.equal(item.reviewAutomation.issueClosurePending, true);
  assert.equal(item.reviewAutomation.reviewEvidenceMissing, true);
  assert.equal(item.reviewAutomation.latestReviewJob.id, 'review-44-3');
  assert.equal(item.reviewAutomation.latestReviewJob.queuePosition, 7);
  assert.equal(item.reviewAutomation.latestReviewJob.conversationUrl, 'https://chatgpt.com/c/44');
  assert.equal(item.reviewAutomation.latestFixJob.id, 'fix-44-3');
  assert.equal(item.reviewAutomation.latestFixJob.coderAgentId, 'fix-agent');
});

test('completed merged issue runs remain recorded but do not count as active work', () => {
  const queue = managerWorkQueue([{
    issueNumber: 274,
    issueTitle: 'Reconcile accepted OpenSpec and rewrite status',
    status: 'completed',
    phase: 'completed',
    prNumber: 383,
    mergedHeadSha: '0298d691a043ce5c0bff81678edbb67b1ff5306c',
    completedAt: '2026-08-09T04:06:31.000Z',
  }]);

  assert.equal(queue.total, 1);
  assert.equal(queue.active, 0);
  assert.equal(queue.items[0].stage, 'completed');
  assert.equal(queue.items[0].stageLabel, 'Completed');
  assert.deepEqual(queue.items[0].pullRequest, { number: 383, url: null });
});

test('queue reports stage and attention counts', () => {
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
