import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reviewRequestIdentity,
  runStructuredReviewWithRetry,
  structuredReviewSchemaFailureDetail,
} from '../src/review-output-retry.mjs';

function schemaError(detail = 'Unterminated string in JSON at position 855') {
  const error = new Error(`paseo run --secret-prompt failed: INVALID_OUTPUT_SCHEMA ${detail}`);
  error.stderr = `INVALID_OUTPUT_SCHEMA\nFailed to parse output schema JSON: ${detail}`;
  return error;
}

test('structured review retries one malformed schema result with the same request identity', () => {
  const requestId = reviewRequestIdentity({
    issueNumber: 239,
    pullRequestNumber: 246,
    headSha: '1a3097b84539f48eb0b793cb1183916ea6613b94',
    stage: 'quick',
    round: 1,
  });
  const attempts = [];
  const retries = [];
  const result = runStructuredReviewWithRetry({
    expectedHeadSha: '1a3097b84539f48eb0b793cb1183916ea6613b94',
    requestId,
    currentHead: () => '1a3097b84539f48eb0b793cb1183916ea6613b94',
    runReview(context) {
      attempts.push(context);
      if (attempts.length === 1) throw schemaError();
      return { decision: { action: 'quick-passed' } };
    },
    onRetry: (context) => retries.push(context),
  });

  assert.equal(result.stale, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.requestId, requestId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, requestId);
  assert.equal(attempts[1].requestId, requestId);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].attempt, 2);
  assert.match(retries[0].detail, /INVALID_OUTPUT_SCHEMA/);
});

test('structured review does not retry stale exact-head work', () => {
  let attempts = 0;
  let stale = null;
  const result = runStructuredReviewWithRetry({
    expectedHeadSha: '1a3097b84539f48eb0b793cb1183916ea6613b94',
    requestId: 'issue-239:pr-246:1a3097b:quick:round-1',
    currentHead: () => 'deadbee84539f48eb0b793cb1183916ea6613b94',
    runReview() {
      attempts += 1;
      throw schemaError();
    },
    onStale: (context) => { stale = context; },
  });

  assert.equal(result.stale, true);
  assert.equal(attempts, 1);
  assert.equal(stale.currentHeadSha, 'deadbee84539f48eb0b793cb1183916ea6613b94');
});

test('structured review fails closed after the bounded retry without leaking the original prompt', () => {
  let attempts = 0;
  let exhausted = null;
  assert.throws(
    () => runStructuredReviewWithRetry({
      expectedHeadSha: '1a3097b84539f48eb0b793cb1183916ea6613b94',
      requestId: 'issue-239:pr-246:1a3097b:quick:round-1',
      currentHead: () => '1a3097b84539f48eb0b793cb1183916ea6613b94',
      runReview() {
        attempts += 1;
        throw schemaError('Unterminated string in JSON at position 855');
      },
      onExhausted: (context) => { exhausted = context; },
    }),
    (error) => {
      assert.equal(error.code, 'REVIEW_OUTPUT_SCHEMA_RETRY_EXHAUSTED');
      assert.match(error.message, /after 2 attempts/);
      assert.match(error.message, /Unterminated string/);
      assert.doesNotMatch(error.message, /secret-prompt/);
      return true;
    },
  );
  assert.equal(attempts, 2);
  assert.equal(exhausted.attempt, 2);
});

test('non-schema reviewer failures are not retried', () => {
  let attempts = 0;
  const original = new Error('reviewer transport timed out');
  assert.throws(
    () => runStructuredReviewWithRetry({
      expectedHeadSha: '1a3097b84539f48eb0b793cb1183916ea6613b94',
      requestId: 'issue-239:pr-246:1a3097b:quick:round-1',
      currentHead: () => '1a3097b84539f48eb0b793cb1183916ea6613b94',
      runReview() {
        attempts += 1;
        throw original;
      },
    }),
    original,
  );
  assert.equal(attempts, 1);
});

test('schema failure detail prefers stderr over command text', () => {
  const error = schemaError();
  const detail = structuredReviewSchemaFailureDetail(error);
  assert.match(detail, /^INVALID_OUTPUT_SCHEMA/);
  assert.doesNotMatch(detail, /secret-prompt/);
});
