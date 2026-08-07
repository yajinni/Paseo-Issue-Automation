import assert from 'node:assert/strict';
import test from 'node:test';
import {
  harnessReviewRoundLimit,
  harnessReviewStage,
  nextReviewRound,
  quickExhaustionHandoff,
  reviewStageDecision,
  summarizeReviewFindings,
  unresolvedQuickFindings,
  validateHarnessReviewVerdict,
} from '../src/harness-review-stages.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';

function config(workflow = 'quick-manual', quickMaxRounds = 3, fullMaxRounds = 3) {
  return { review: { workflow, quickMaxRounds, fullMaxRounds } };
}

test('selects explicit quick and full stages with independent limits through 20', () => {
  assert.equal(harnessReviewStage(config('quick-manual', 20, 2)), 'quick');
  assert.equal(harnessReviewRoundLimit(config('quick-manual', 20, 2), 'quick'), 20);
  assert.equal(harnessReviewStage(config('full-immediate', 2, 20)), 'full');
  assert.equal(harnessReviewRoundLimit(config('full-immediate', 2, 20), 'full'), 20);
});

test('initial review is round one and stage rounds survive commit changes', () => {
  const state = { events: [
    { event: 'harness-review', stage: 'quick', round: 1, commit: 'aaaaaaa', result: 'CHANGES_REQUIRED' },
    { event: 'validation-summary', result: 'PASS', commit: 'bbbbbbb' },
  ] };
  assert.equal(nextReviewRound({}, 'quick'), 1);
  assert.equal(nextReviewRound(state, 'quick'), 2);
  assert.equal(nextReviewRound(state, 'full'), 1);
});

test('quick exhaustion hands off without needs-attention while full exhaustion requires attention', () => {
  const quickState = { events: [
    { event: 'harness-review', stage: 'quick', round: 1, result: 'CHANGES_REQUIRED' },
    { event: 'harness-review', stage: 'quick', round: 2, result: 'CHANGES_REQUIRED' },
  ] };
  assert.deepEqual(reviewStageDecision({
    config: config('quick-manual', 3, 3),
    state: quickState,
    stage: 'quick',
    verdict: { result: 'changes' },
  }), { action: 'handoff', target: 'manual', round: 3, limit: 3 });
  assert.equal(quickExhaustionHandoff(config('quick-web-chatgpt')), 'web-chatgpt');

  const fullState = { events: [
    { event: 'harness-review', stage: 'full', round: 1, result: 'CHANGES_REQUIRED' },
    { event: 'harness-review', stage: 'full', round: 2, result: 'CHANGES_REQUIRED' },
  ] };
  assert.deepEqual(reviewStageDecision({
    config: config('full-immediate', 3, 3),
    state: fullState,
    stage: 'full',
    verdict: { result: 'changes' },
  }), { action: 'attention', round: 3, limit: 3 });
});

test('quick pass advances immediately and stale results never approve code', () => {
  assert.deepEqual(reviewStageDecision({ config: config(), state: {}, stage: 'quick', verdict: { result: 'pass' } }), {
    action: 'quick-passed',
  });
  assert.deepEqual(reviewStageDecision({ config: config(), state: {}, stage: 'quick', verdict: { result: 'stale' } }), {
    action: 'stale',
  });
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
});

test('quick findings remain handoff context but only blocking findings carry forward', () => {
  const state = { events: [{
    event: 'harness-review',
    stage: 'quick',
    result: 'CHANGES_REQUIRED',
    findings: [
      { severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs' },
      { severity: 'non-blocking', message: 'Optional cleanup.' },
    ],
  }] };
  assert.deepEqual(unresolvedQuickFindings(state), [
    { severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs' },
  ]);
  assert.match(summarizeReviewFindings({
    findings: [{ severity: 'blocking', message: 'Fix this.', file: 'src/a.mjs', line: 3, requiredChange: 'Correct it.' }],
  }), /src\/a\.mjs:3/);
});
