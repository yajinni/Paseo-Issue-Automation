import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingReviewResult, parsePaseoReviewMarker } from '../src/review-result.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';

const body = `<!-- paseo-review:v1
{"reviewRequestId":"paseo-review-1","repository":"owner/repo","pullRequestNumber":45,"issueNumber":101,"headSha":"abcdef123","reviewRound":2,"promptVersion":1,"result":"changes_requested"}
-->

### Blocking findings
- Fix src/a.mjs and add a test.`;

function stagedBody({ stage = 'full', round = 2, promptVersion = REVIEW_WORKFLOW_PROMPT_VERSION } = {}) {
  return `<!-- paseo-review:v1
{"reviewRequestId":"paseo-review-1","repository":"owner/repo","pullRequestNumber":45,"issueNumber":101,"headSha":"abcdef123","reviewRound":2,"stage":"${stage}","round":${round},"promptVersion":${promptVersion},"result":"changes_requested"}
-->

### Blocking findings
- Restore required CI.`;
}

const expected = {
  reviewRequestId: 'paseo-review-1', repository: 'owner/repo', pullRequestNumber: 45,
  issueNumber: 101, headSha: 'abcdef123', promptVersion: 1,
};

test('structured review marker retains machine metadata and human findings', () => {
  const [result] = parsePaseoReviewMarker(body);
  assert.equal(result.result, 'changes_requested');
  assert.equal(result.headSha, 'abcdef123');
  assert.match(result.humanMarkdown, /Fix src\/a.mjs/);
});

test('matching results reject stale or unrelated review requests', () => {
  const match = matchingReviewResult({ comments: [{ id: 5, body, createdAt: '2026-08-03T10:00:00Z' }] }, expected);
  assert.equal(match.sourceId, 5);
  assert.equal(matchingReviewResult({ comments: [{ id: 5, body }] }, {
    ...expected,
    reviewRequestId: 'other',
  }), null);
});

test('staged full-review marker accepts the controller workflow prompt version for a legacy browser job', () => {
  const match = matchingReviewResult({
    comments: [{ id: 6, body: stagedBody(), createdAt: '2026-08-12T20:57:21Z' }],
  }, expected);
  assert.equal(match?.sourceId, 6);
  assert.equal(match?.stage, 'full');
  assert.equal(match?.promptVersion, REVIEW_WORKFLOW_PROMPT_VERSION);
});

test('prompt-version compatibility is limited to a proper full-stage marker with matching round identity', () => {
  assert.equal(matchingReviewResult({ comments: [{ id: 7, body: stagedBody({ stage: 'quick' }) }] }, expected), null);
  assert.equal(matchingReviewResult({ comments: [{ id: 8, body: stagedBody({ round: 1 }) }] }, expected), null);
  assert.equal(matchingReviewResult({ comments: [{ id: 9, body: stagedBody({ promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION + 1 }) }] }, expected), null);
});
