import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateApprovedReviewGate, summarizeReviewGateChecks } from '../src/pr-review-finalize.mjs';

const managed = {
  issueNumber: 12,
  pullRequestNumber: 34,
  currentHeadSha: 'abcdef123',
  branchName: 'ai/issue-12-test',
};
const job = { headSha: 'abcdef123', reviewRequestId: 'request-1' };
const config = { baseBranch: 'main' };
const runState = {
  issueNumber: 12,
  events: [{ event: 'validation-summary', result: 'PASS', commit: 'abcdef123' }],
};
const basePr = {
  state: 'OPEN',
  headRefOid: 'abcdef123',
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS' }],
};

function successfulRunner() {
  return { ok: true, stdout: '', stderr: '' };
}

test('check summaries distinguish pending and failed checks', () => {
  assert.equal(summarizeReviewGateChecks([{ name: 'test', status: 'IN_PROGRESS' }]).state, 'pending');
  assert.equal(summarizeReviewGateChecks([{ name: 'test', conclusion: 'FAILURE' }]).state, 'failed');
  assert.equal(summarizeReviewGateChecks([{ name: 'test', conclusion: 'SUCCESS' }]).state, 'passed');
});

test('approved review gate requires the exact current validated SHA', () => {
  const stale = evaluateApprovedReviewGate('/repo', managed, job, { ...basePr, headRefOid: 'fffffff12' }, {
    runner: successfulRunner,
    config,
    runState,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);

  const missingValidation = evaluateApprovedReviewGate('/repo', managed, job, basePr, {
    runner: successfulRunner,
    config,
    runState: { events: [] },
  });
  assert.equal(missingValidation.ok, false);
  assert.equal(missingValidation.repair, true);
  assert.match(missingValidation.reason, /validation-summary/);
});

test('approved review gate waits for pending CI and repairs failed CI', () => {
  const pending = evaluateApprovedReviewGate('/repo', managed, job, {
    ...basePr,
    statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }],
  }, { runner: successfulRunner, config, runState });
  assert.equal(pending.waiting, true);

  const failed = evaluateApprovedReviewGate('/repo', managed, job, {
    ...basePr,
    statusCheckRollup: [{ name: 'test', conclusion: 'FAILURE' }],
  }, { runner: successfulRunner, config, runState });
  assert.equal(failed.repair, true);
  assert.match(failed.reason, /test: FAILURE/);
});

test('approved review gate refreshes the exact remote-tracking refs it evaluates', () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    return { ok: true, stdout: '', stderr: '' };
  };
  const result = evaluateApprovedReviewGate('/repo', managed, job, basePr, {
    runner,
    config,
    runState,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, [
    'fetch', '--prune', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/ai/issue-12-test:refs/remotes/origin/ai/issue-12-test',
  ]);
  assert.deepEqual(calls[1].args, [
    'merge-base', '--is-ancestor',
    'refs/remotes/origin/main',
    'refs/remotes/origin/ai/issue-12-test',
  ]);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.equal(calls[0].options.allowFailure, true);
});

test('approved review gate passes only after CI, base freshness, and conflict checks', () => {
  const result = evaluateApprovedReviewGate('/repo', managed, job, basePr, {
    runner: successfulRunner,
    config,
    runState,
  });
  assert.equal(result.ok, true);
  assert.equal(result.commit, 'abcdef123');
});
