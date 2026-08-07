import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HARNESS_RUNTIME_STAGES,
  createHarnessReviewEvent,
  createQuickHandoffEvent,
  harnessReviewRoundLimit,
  harnessReviewStage,
  harnessRuntimeStage,
  invalidateAfterRepair,
  nextReviewRound,
  quickExhaustionHandoff,
  reviewFreshness,
  reviewStageDecision,
  summarizeReviewFindings,
  unresolvedQuickFindings,
  validateHarnessReviewVerdict,
} from '../src/harness-review-stages.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';

function config(workflow = 'quick-manual', quickMaxRounds = 3, fullMaxRounds = 3) {
  return { review: { workflow, quickMaxRounds, fullMaxRounds } };
}

test('selects explicit quick and full-immediate runtime stages with independent limits through 20', () => {
  assert.equal(harnessRuntimeStage(config('quick-manual', 20, 2)), HARNESS_RUNTIME_STAGES.quick);
  assert.equal(harnessReviewStage(config('quick-manual', 20, 2)), 'quick');
  assert.equal(harnessReviewRoundLimit(config('quick-manual', 20, 2), 'quick'), 20);
  assert.equal(harnessRuntimeStage(config('full-immediate', 2, 20)), HARNESS_RUNTIME_STAGES.fullImmediate);
  assert.equal(harnessReviewStage(config('full-immediate', 2, 20)), 'full');
  assert.equal(harnessReviewRoundLimit(config('full-immediate', 2, 20), 'full'), 20);
});

test('initial review is round one and every completed review result advances the stage round', () => {
  const state = { events: [
    { event: 'harness-review', stage: 'quick', round: 1, headSha: 'aaaaaaa', result: 'changes' },
    { event: 'validation-summary', result: 'pass', headSha: 'bbbbbbb' },
  ] };
  assert.equal(nextReviewRound({}, 'quick'), 1);
  assert.equal(nextReviewRound(state, 'quick'), 2);
  assert.equal(nextReviewRound(state, 'full'), 1);
});

test('quick exhaustion hands off without needs-attention while full exhaustion requires attention', () => {
  const quickState = { events: [
    { event: 'harness-review', stage: 'quick', round: 1, result: 'changes' },
    { event: 'harness-review', stage: 'quick', round: 2, result: 'changes' },
  ] };
  assert.deepEqual(reviewStageDecision({
    config: config('quick-manual', 3, 3),
    state: quickState,
    stage: 'quick',
    verdict: { result: 'changes' },
  }), { action: 'handoff', target: 'full-manual', round: 3, limit: 3, needsAttention: false });
  assert.equal(quickExhaustionHandoff(config('quick-web-chatgpt')), 'full-web-chatgpt');

  const fullState = { events: [
    { event: 'harness-review', stage: 'full', round: 1, result: 'changes' },
    { event: 'harness-review', stage: 'full', round: 2, result: 'changes' },
  ] };
  assert.deepEqual(reviewStageDecision({
    config: config('full-immediate', 3, 3),
    state: fullState,
    stage: 'full',
    verdict: { result: 'changes' },
  }), { action: 'attention', round: 3, limit: 3, changesRequested: true, needsAttention: true });
});

test('quick pass advances immediately and stale results never approve code', () => {
  assert.deepEqual(reviewStageDecision({ config: config(), state: {}, stage: 'quick', verdict: { result: 'pass' } }), {
    action: 'quick-passed',
  });
  assert.deepEqual(reviewStageDecision({ config: config(), state: {}, stage: 'quick', verdict: { result: 'stale' } }), {
    action: 'stale',
  });
});

test('freshness requires the exact requested head and preserves optional base freshness checks', () => {
  assert.deepEqual(reviewFreshness({
    requestedHeadSha: 'abcdef1',
    currentHeadSha: 'abcdef1',
    requestedBaseSha: '1234567',
    currentBaseSha: '1234567',
  }), { fresh: true, reason: null });
  assert.deepEqual(reviewFreshness({ requestedHeadSha: 'abcdef1', currentHeadSha: 'deadbee' }), {
    fresh: false,
    reason: 'head-changed',
  });
  assert.deepEqual(reviewFreshness({
    requestedHeadSha: 'abcdef1',
    currentHeadSha: 'abcdef1',
    requestedBaseSha: '1234567',
    currentBaseSha: '7654321',
  }), { fresh: false, reason: 'base-changed' });
});

test('verdict identity is bound to repository PR issue SHA stage round and prompt version', () => {
  const expected = {
    repository: 'owner/repo',
    pullRequestNumber: 12,
    issueNumber: 9,
    headSha: 'abcdef1234567890',
    stage: 'quick',
    round: 1,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
  };
  const verdict = {
    ...expected,
    result: 'pass',
    summary: 'Looks good.',
    findings: [],
  };
  assert.equal(validateHarnessReviewVerdict(verdict, expected), verdict);
  assert.throws(() => validateHarnessReviewVerdict({ ...verdict, headSha: 'deadbee' }, expected), /headSha/);
  assert.deepEqual(createHarnessReviewEvent(verdict, expected, { at: '2026-08-07T00:00:00.000Z' }), {
    event: 'harness-review',
    stage: 'quick',
    round: 1,
    result: 'pass',
    headSha: 'abcdef1234567890',
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
    summary: 'Looks good.',
    findings: [],
    at: '2026-08-07T00:00:00.000Z',
  });
});

test('every repair invalidates prior validation and review approval before the next round', () => {
  const repaired = invalidateAfterRepair({
    currentHeadSha: 'abcdef1',
    validationApproved: true,
    validationHeadSha: 'abcdef1',
    reviewApproved: true,
    approvedHeadSha: 'abcdef1',
    events: [],
  }, {
    previousHeadSha: 'abcdef1',
    newHeadSha: 'bcdefa2',
    at: '2026-08-07T00:00:00.000Z',
  });
  assert.equal(repaired.currentHeadSha, 'bcdefa2');
  assert.equal(repaired.validationApproved, false);
  assert.equal(repaired.validationHeadSha, null);
  assert.equal(repaired.reviewApproved, false);
  assert.equal(repaired.approvedHeadSha, null);
  assert.deepEqual(repaired.events[0], {
    event: 'harness-review-repair',
    previousHeadSha: 'abcdef1',
    newHeadSha: 'bcdefa2',
    invalidatedValidation: true,
    invalidatedReviewApproval: true,
    at: '2026-08-07T00:00:00.000Z',
  });
  assert.throws(() => invalidateAfterRepair({ currentHeadSha: 'abcdef1' }, { newHeadSha: 'abcdef1' }), /new exact PR head SHA/);
});

test('quick findings remain handoff context and are independently rechecked by the later full stage', () => {
  const state = { events: [{
    event: 'harness-review',
    stage: 'quick',
    result: 'changes',
    findings: [
      { severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs' },
      { severity: 'non-blocking', message: 'Optional cleanup.' },
    ],
  }] };
  assert.deepEqual(unresolvedQuickFindings(state), [
    { severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs' },
  ]);
  assert.deepEqual(createQuickHandoffEvent(config('quick-web-chatgpt'), state, { at: '2026-08-07T00:00:00.000Z' }), {
    event: 'harness-review-handoff',
    from: 'quick',
    to: 'full-web-chatgpt',
    unresolvedFindings: [{ severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs' }],
    needsAttention: false,
    at: '2026-08-07T00:00:00.000Z',
  });
  assert.match(summarizeReviewFindings({
    findings: [{ severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs', line: 3, requiredChange: 'Correct it.' }],
  }), /src\/a\.mjs:3/);
});
