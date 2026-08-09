import assert from 'node:assert/strict';
import test from 'node:test';
import {
  managerReviewEvidenceSummary,
  reviewEvidenceForRun,
} from '../src/manager-review-evidence.mjs';

function config(workflow = 'quick-manual') {
  return {
    review: { workflow, quickMaxRounds: 3, fullMaxRounds: 4 },
    maxReviewRounds: 4,
  };
}

function run(overrides = {}) {
  return {
    issueNumber: 42,
    prNumber: 77,
    currentHeadSha: 'head-current',
    reviewRuntimeStage: 'quick',
    events: [],
    ...overrides,
  };
}

function store(overrides = {}) {
  return {
    managedPullRequests: [{
      id: 'managed-42',
      issueNumber: 42,
      pullRequestNumber: 77,
      currentHeadSha: 'head-current',
      reviewState: 'awaiting_result',
      reviewRound: 1,
      reviewPromptVersion: 1,
      activeReviewRequestId: 'request-1',
      lastActivityAt: '2026-08-09T12:10:00.000Z',
      ...overrides.managed,
    }],
    reviewJobs: [{
      id: 'job-1',
      managedPullRequestId: 'managed-42',
      headSha: 'head-current',
      promptVersion: 1,
      reviewRound: 1,
      reviewRequestId: 'request-1',
      state: 'awaiting_result',
      queuePosition: 3,
      attempts: 1,
      createdAt: '2026-08-09T12:00:00.000Z',
      submittedAt: '2026-08-09T12:05:00.000Z',
      updatedAt: '2026-08-09T12:10:00.000Z',
      ...overrides.job,
    }],
    fixJobs: [],
  };
}

test('Light Review exposes exact-head structured findings and real counts only', () => {
  const evidence = reviewEvidenceForRun(run({
    events: [{
      event: 'harness-review',
      stage: 'quick',
      round: 1,
      result: 'changes',
      headSha: 'head-current',
      promptVersion: 1,
      summary: 'One blocking issue and one suggestion.',
      findings: [
        { severity: 'blocking', message: 'Fix retry loop.', file: 'src/retry.mjs', line: 20, requiredChange: 'Bound retries.' },
        { severity: 'non-blocking', message: 'Clarify comment.' },
      ],
      at: '2026-08-09T12:11:00.000Z',
    }],
  }), store(), config());

  assert.equal(evidence.type, 'light');
  assert.equal(evidence.label, 'Light Review');
  assert.equal(evidence.round, 1);
  assert.equal(evidence.limit, 3);
  assert.equal(evidence.result, 'Changes requested');
  assert.equal(evidence.headMatchesCurrent, true);
  assert.equal(evidence.structuredFindings, true);
  assert.deepEqual(evidence.findingCounts, { blocking: 1, nonBlocking: 1, total: 2 });
  assert.equal(evidence.findings[0].file, 'src/retry.mjs');
  assert.equal(evidence.findings[0].requiredChange, 'Bound retries.');
});

test('Heavy Review is derived from a full-immediate review without inventing escalation', () => {
  const evidence = reviewEvidenceForRun(run({
    reviewRuntimeStage: 'full-immediate',
    events: [{ event: 'harness-review', stage: 'full', round: 2, result: 'pass', headSha: 'head-current', findings: [], at: '2026-08-09T12:15:00.000Z' }],
  }), store(), config('full-immediate'));

  assert.equal(evidence.type, 'heavy');
  assert.equal(evidence.label, 'Heavy Review');
  assert.equal(evidence.limit, 4);
  assert.equal(evidence.result, 'Approved');
  assert.equal(evidence.handoff, null);
});

test('Web ChatGPT evidence exposes browser job identity and conversation timing but no fake transcript metrics', () => {
  const evidence = reviewEvidenceForRun(run({
    reviewRuntimeStage: 'full-web-chatgpt',
    events: [{ event: 'harness-review', stage: 'full', round: 1, result: 'pass', headSha: 'head-current', promptVersion: 1, findings: [], at: '2026-08-09T12:20:00.000Z' }],
  }), store({ job: {
    conversationUrlUsed: 'https://chatgpt.com/c/example',
    completedAt: '2026-08-09T12:20:00.000Z',
    result: 'approved',
    resultSourceId: 987,
  } }), config('quick-web-chatgpt'));

  assert.equal(evidence.type, 'web-chatgpt');
  assert.equal(evidence.label, 'Web ChatGPT Review');
  assert.equal(evidence.conversationSource, 'Web ChatGPT (Browser)');
  assert.equal(evidence.conversationUrl, 'https://chatgpt.com/c/example');
  assert.equal(evidence.jobId, 'job-1');
  assert.equal(evidence.reviewRequestId, 'request-1');
  assert.equal(evidence.resultSourceId, 987);
  assert.equal(evidence.submittedAt, '2026-08-09T12:05:00.000Z');
  assert.equal('messagesExchanged' in evidence, false);
  assert.equal('pagesReviewed' in evidence, false);
  assert.equal('artifactsAnalyzed' in evidence, false);
  assert.equal('model' in evidence, false);
  assert.equal('thinking' in evidence, false);
});

test('old-head findings are not presented as current review evidence after the PR head changes', () => {
  const evidence = reviewEvidenceForRun(run({
    currentHeadSha: 'head-new',
    events: [{ event: 'harness-review', stage: 'quick', round: 1, result: 'changes', headSha: 'head-old', findings: [{ severity: 'blocking', message: 'Old finding.' }], at: '2026-08-09T11:00:00.000Z' }],
  }), store({
    managed: { currentHeadSha: 'head-new', activeReviewRequestId: null },
    job: { headSha: 'head-old', state: 'completed', result: 'changes_requested', completedAt: '2026-08-09T11:01:00.000Z' },
  }), config());

  assert.equal(evidence.currentHeadSha, 'head-new');
  assert.equal(evidence.structuredFindings, false);
  assert.equal(evidence.findingCounts.total, 0);
  assert.equal(evidence.summary, null);
  assert.equal(evidence.jobId, null);
});

test('quick-to-full handoff preserves only recorded unresolved finding evidence', () => {
  const evidence = reviewEvidenceForRun(run({
    reviewRuntimeStage: 'full-web-chatgpt',
    events: [{
      event: 'harness-review-handoff',
      from: 'quick',
      to: 'full-web-chatgpt',
      unresolvedFindings: [{ severity: 'blocking', message: 'Verify retry safety.' }],
      at: '2026-08-09T12:02:00.000Z',
    }],
  }), store({ job: { conversationUrlUsed: 'https://chatgpt.com/c/example' } }), config('quick-web-chatgpt'));

  assert.equal(evidence.handoff.from, 'quick');
  assert.equal(evidence.handoff.to, 'full-web-chatgpt');
  assert.equal(evidence.handoff.unresolvedCount, 1);
  assert.equal(evidence.handoff.unresolvedFindings[0].message, 'Verify retry safety.');
});

test('summary returns evidence only for recorded issues with a current PR', () => {
  const summary = managerReviewEvidenceSummary([
    run(),
    { issueNumber: 43, phase: 'coding', events: [] },
  ], store(), config());
  assert.ok(summary.byIssue['42']);
  assert.equal(summary.byIssue['43'], undefined);
});
