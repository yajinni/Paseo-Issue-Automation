import assert from 'node:assert/strict';
import test from 'node:test';
import { codingFixPrompt } from '../src/fix-jobs.mjs';
import { validateFixedHead } from '../src/fix-worker.mjs';

const managed = {
  issueNumber: 12,
  pullRequestNumber: 34,
  branchName: 'ai/issue-12-test',
};
const job = {
  reviewedHeadSha: 'abcdef123',
  reviewRequestId: 'review-1',
  sourceReviewRound: 1,
  sourceReviewCommentId: 12345,
};
const config = { baseBranch: 'main' };
const pr = {
  state: 'OPEN',
  headRefOid: 'fffffff12',
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
};
const successfulRunner = (_command, args) => {
  if (args[0] === 'rev-parse') return { ok: true, stdout: `${pr.headRefOid}\n`, stderr: '' };
  if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
  if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
  if (args[0] === 'merge-base') return { ok: true, stdout: '', stderr: '' };
  throw new Error(`Unexpected git command: ${args.join(' ')}`);
};

test('fix prompt assigns exact-head validation bookkeeping to the controller', () => {
  const prompt = codingFixPrompt({
    ...managed,
    repository: 'owner/repo',
    pullRequestUrl: 'https://github.com/owner/repo/pull/34',
    issueUrl: 'https://github.com/owner/repo/issues/12',
  }, { ...job, findings: 'Repair the edge case.' });
  assert.match(prompt, /fix worker owns internal exact-head validation bookkeeping/i);
  assert.match(prompt, /worktree HEAD and PR head are the same exact SHA/i);
  assert.match(prompt, /Run changed-area validation and every validation required by the issue/);
  assert.doesNotMatch(prompt, /--commit <new-head-sha>/);
  assert.doesNotMatch(prompt, /paseo-issue-automation record/);
});

test('fixed head records controller validation for its exact SHA after worktree verification', () => {
  let recorded = null;
  const result = validateFixedHead('/repo', managed, job, pr, {
    config,
    runState: { events: [{ event: 'validation-summary', result: 'PASS', commit: 'eeeeeee11' }] },
    runner: successfulRunner,
    recordValidation(_root, issueNumber, event) {
      recorded = { issueNumber, event };
      return {
        events: [
          { event: 'validation-summary', result: 'PASS', commit: 'eeeeeee11' },
          event,
        ],
      };
    },
  });
  assert.equal(result.newHeadSha, pr.headRefOid);
  assert.equal(result.validation.commit, pr.headRefOid);
  assert.equal(recorded.issueNumber, managed.issueNumber);
  assert.equal(recorded.event.commit, pr.headRefOid);
  assert.equal(recorded.event.result, 'PASS');
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
