import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyIssueFailure, issueFailureRetryDecision } from '../src/issue-failure-policy.mjs';

const config = { issueSelection: { temporaryFailureRetries: 3 } };

test('only transient infrastructure/provider classes are retryable', () => {
  assert.deepEqual(classifyIssueFailure(new Error('ECONNRESET contacting provider')).type, 'network');
  assert.equal(classifyIssueFailure(new Error('ECONNRESET contacting provider')).transient, true);
  assert.equal(classifyIssueFailure(new Error('GitHub API 503 service unavailable')).type, 'github-availability');
  assert.equal(classifyIssueFailure(new Error('Provider overloaded HTTP 429')).type, 'provider');
  assert.equal(classifyIssueFailure(new Error('spawn EAGAIN')).type, 'process');
});

test('permissions, invalid content, unsafe ambiguity, validation, and merge conflicts never retry', () => {
  const messages = [
    'HTTP 403 permission denied',
    'Objective is required.',
    'Multiple matching agents are ambiguous; operator action is required.',
    'Deterministic validation failed.',
    'GitHub reports merge conflicts.',
  ];
  for (const message of messages) assert.equal(classifyIssueFailure(new Error(message)).transient, false, message);
});

test('retry count uses configured maximum across scheduler turns', () => {
  const error = new Error('Provider temporarily unavailable');
  assert.deepEqual(issueFailureRetryDecision(error, config, { temporaryFailureCount: 0 }), {
    type: 'provider', transient: true, reason: 'Provider temporarily unavailable', retry: true, exhausted: false, attempt: 1, maximum: 3,
  });
  assert.equal(issueFailureRetryDecision(error, config, { temporaryFailureCount: 2 }).retry, true);
  const exhausted = issueFailureRetryDecision(error, config, { temporaryFailureCount: 3 });
  assert.equal(exhausted.retry, false);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.attempt, 4);
});

test('explicit typed permanent failures cannot be reclassified from message text', () => {
  const error = Object.assign(new Error('network timeout'), { failureType: 'validation' });
  const result = classifyIssueFailure(error);
  assert.equal(result.type, 'validation');
  assert.equal(result.transient, false);
});
