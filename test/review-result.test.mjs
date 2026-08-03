import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingReviewResult, parsePaseoReviewMarker } from '../src/review-result.mjs';

const body = `<!-- paseo-review:v1
{"reviewRequestId":"paseo-review-1","repository":"owner/repo","pullRequestNumber":45,"issueNumber":101,"headSha":"abcdef123","reviewRound":2,"promptVersion":1,"result":"changes_requested"}
-->

### Blocking findings
- Fix src/a.mjs and add a test.`;

test('structured review marker retains machine metadata and human findings', () => {
  const [result] = parsePaseoReviewMarker(body);
  assert.equal(result.result, 'changes_requested');
  assert.equal(result.headSha, 'abcdef123');
  assert.match(result.humanMarkdown, /Fix src\/a.mjs/);
});

test('matching results reject stale or unrelated review requests', () => {
  const match = matchingReviewResult({ comments: [{ id: 5, body, createdAt: '2026-08-03T10:00:00Z' }] }, {
    reviewRequestId: 'paseo-review-1', repository: 'owner/repo', pullRequestNumber: 45,
    issueNumber: 101, headSha: 'abcdef123', promptVersion: 1,
  });
  assert.equal(match.sourceId, 5);
  assert.equal(matchingReviewResult({ comments: [{ id: 5, body }] }, {
    reviewRequestId: 'other', repository: 'owner/repo', pullRequestNumber: 45,
    issueNumber: 101, headSha: 'abcdef123', promptVersion: 1,
  }), null);
});
