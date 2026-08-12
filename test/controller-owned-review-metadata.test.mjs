import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHarnessReviewEvent,
  validateHarnessReviewVerdict,
} from '../src/harness-review-stages.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';

const expected = {
  repository: 'owner/repo',
  pullRequestNumber: 281,
  issueNumber: 280,
  headSha: '646dcb964776274fae19b255d3ad1991429fe118',
  stage: 'quick',
  round: 1,
  promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
};

const payload = {
  result: 'pass',
  summary: 'Exact-head review passed.',
  findings: [],
};

test('payload-only staged verdict receives the controller-owned exact-head identity', () => {
  const bound = validateHarnessReviewVerdict(payload, expected);
  assert.deepEqual(bound, { ...payload, ...expected });
  const event = createHarnessReviewEvent(payload, expected, { at: '2026-08-12T18:45:00.000Z' });
  assert.equal(event.headSha, expected.headSha);
  assert.equal(event.stage, expected.stage);
  assert.equal(event.round, expected.round);
  assert.equal(event.promptVersion, expected.promptVersion);
  assert.equal(event.result, 'pass');
});

test('reviewer-supplied identity cannot override controller-owned review identity', () => {
  const bound = validateHarnessReviewVerdict({
    ...payload,
    repository: 'wrong/repo',
    pullRequestNumber: 999,
    issueNumber: 999,
    headSha: 'deadbee',
    stage: 'full',
    round: 20,
    promptVersion: 999,
  }, expected);
  for (const [field, value] of Object.entries(expected)) assert.equal(bound[field], value);
});
