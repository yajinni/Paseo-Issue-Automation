import assert from 'node:assert/strict';
import test from 'node:test';
import { codingFixPrompt } from '../src/fix-jobs.mjs';
import { validateFixedHead } from '../src/fix-worker.mjs';

const managed = {
  issueNumber: 12,
  pullRequestNumber: 34,
  branchName: 'ai/issue-12-test',
};
const job = { reviewedHeadSha: 'abcdef123', reviewRequestId: 'review-1' };
const config = { baseBranch: 'main' };
const pr = {
  state: 'OPEN',
  headRefOid: 'fffffff12',
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
};
const successfulRunner = () => ({ ok: true, stdout: '', stderr: '' });

test('fix prompt requires an exact validation-summary record', () => {
  const prompt = codingFixPrompt({
    ...managed,
    repository: 'owner/repo',
    pullRequestUrl: 'https://github.com/owner/repo/pull/34',
    issueUrl: 'https://github.com/owner/repo/issues/12',
  }, { ...job, findings: 'Repair the edge case.' });
  assert.match(prompt, /validation-summary/);
  assert.match(prompt, /--commit <new-head-sha>/);
  assert.match(prompt, /worktree HEAD, and recorded validation commit are the same exact SHA/);
});

test('fixed head is rejected without validation for its exact SHA', () => {
  assert.throws(() => validateFixedHead('/repo', managed, job, pr, {
    config,
    runState: { events: [{ event: 'validation-summary', result: 'PASS', commit: 'eeeeeee11' }] },
    runner: successfulRunner,
  }), /did not record passing validation/);
});

test('fixed head is rejected when it is stale or conflicts with base', () => {
  assert.throws(() => validateFixedHead('/repo', managed, job, {
    ...pr,
    headRefOid: job.reviewedHeadSha,
  }, {
    config,
    runState: { events: [] },
    runner: successfulRunner,
  }), /without pushing a new PR head/);

  assert.throws(() => validateFixedHead('/repo', managed, job, {
    ...pr,
    mergeable: 'CONFLICTING',
  }, {
    config,
    runState: { events: [{ event: 'validation-summary', result: 'PASS', commit: pr.headRefOid }] },
    runner: successfulRunner,
  }), /conflicts with main/);
});

test('fixed head passes only with exact validation and current base', () => {
  const result = validateFixedHead('/repo', managed, job, pr, {
    config,
    runState: { events: [{ event: 'validation-summary', result: 'PASS', commit: pr.headRefOid }] },
    runner: successfulRunner,
  });
  assert.equal(result.newHeadSha, pr.headRefOid);
  assert.equal(result.validation.commit, pr.headRefOid);
});
