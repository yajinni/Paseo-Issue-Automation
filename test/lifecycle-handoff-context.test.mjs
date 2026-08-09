import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepairPrompt } from '../src/controller-prompts.mjs';
import { codingFixPrompt } from '../src/fix-jobs.mjs';
import { validateFixedHead } from '../src/fix-worker.mjs';

const oldHead = 'abcdef1234567890';
const newHead = 'fedcba0987654321';

function managed(overrides = {}) {
  return {
    repository: 'owner/repo',
    pullRequestNumber: 383,
    pullRequestUrl: 'https://github.com/owner/repo/pull/383',
    issueNumber: 274,
    issueUrl: 'https://github.com/owner/repo/issues/274',
    branchName: 'ai/issue-274-repair',
    worktreePath: '/worktree',
    reviewRound: 4,
    lastReviewCommentId: 9911,
    ...overrides,
  };
}

function fixJob(overrides = {}) {
  return {
    reviewedHeadSha: oldHead,
    reviewRequestId: 'paseo-review-request-7',
    sourceReviewRound: 4,
    sourceReviewCommentId: 9911,
    findings: 'Fix the status transition and add the missing regression test.',
    ...overrides,
  };
}

test('serial review repair prompt carries the complete authoritative review identity and findings', () => {
  const prompt = codingFixPrompt(managed(), fixJob());
  for (const expected of [
    'owner/repo',
    'Pull request: #383',
    'https://github.com/owner/repo/pull/383',
    'Associated issue: #274',
    'https://github.com/owner/repo/issues/274',
    'ai/issue-274-repair',
    oldHead,
    'paseo-review-request-7',
    'Review round: 4',
    'Matching PR review comment ID: 9911',
    'Fix the status transition and add the missing regression test.',
  ]) assert.match(prompt, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /authoritative repair instructions/i);
  assert.match(prompt, /Do not search repository files, issue prose, PR reviewDecision, or unrelated PR reviews\/comments to discover/i);
  assert.match(prompt, /paseo-review:v1/);
  assert.match(prompt, /fix worker owns internal exact-head validation bookkeeping/i);
  assert.doesNotMatch(prompt, /paseo-issue-automation record/);
});

test('serial repair prompt uses immutable job review identity after the managed PR advances', () => {
  const prompt = codingFixPrompt(
    managed({ reviewRound: 9, lastReviewCommentId: 778899 }),
    fixJob({ sourceReviewRound: 4, sourceReviewCommentId: 9911 }),
  );
  assert.match(prompt, /Review round: 4/);
  assert.match(prompt, /Matching PR review comment ID: 9911/);
  assert.doesNotMatch(prompt, /Review round: 9/);
  assert.doesNotMatch(prompt, /778899/);
});

test('serial repair prompt fails closed when immutable source review identity is missing', () => {
  assert.throws(
    () => codingFixPrompt(managed(), fixJob({ sourceReviewRound: undefined })),
    /missing its immutable source review round/,
  );
});

test('serial repair prompt fails closed when the authoritative finding payload is empty', () => {
  const prompt = codingFixPrompt(managed(), fixJob({ findings: '' }));
  assert.match(prompt, /No repair instructions were recorded/);
  assert.match(prompt, /Stop without changing code/);
});

test('same-coder controller repair prompt treats embedded findings as authoritative instead of asking for rediscovery', () => {
  const prompt = buildRepairPrompt({ issueNumber: 274, findings: 'Correct the exact-head comparison.' });
  assert.match(prompt, /already accepted the following repair instructions/);
  assert.match(prompt, /Correct the exact-head comparison/);
  assert.match(prompt, /Do not search repository files, issue prose, PR reviewDecision, or unrelated review comments to rediscover/i);
  assert.match(prompt, /controller owns validation-summary bookkeeping/i);
});

test('fix worker records validation itself only after clean local HEAD matches the repaired PR head', () => {
  const calls = [];
  let recorded = null;
  const runner = (_command, args, options) => {
    calls.push({ args, options });
    if (args[0] === 'rev-parse') return { ok: true, stdout: `${newHead}\n`, stderr: '' };
    if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'merge-base') return { ok: true, stdout: '', stderr: '' };
    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
  const result = validateFixedHead('/repo', managed(), fixJob(), {
    state: 'OPEN',
    headRefOid: newHead,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
  }, {
    config: { baseBranch: 'main' },
    runState: { events: [] },
    runner,
    recordValidation(_root, issueNumber, event) {
      recorded = { issueNumber, event };
      return { events: [{ ...event, at: '2026-08-09T00:00:00Z' }] };
    },
  });
  assert.equal(result.newHeadSha, newHead);
  assert.equal(recorded.issueNumber, 274);
  assert.deepEqual(recorded.event, {
    event: 'validation-summary',
    result: 'PASS',
    commit: newHead,
    details: 'PR fix worker recorded the exact-head validation handoff after the fix Coder completed with a clean worktree whose local HEAD matched the pushed PR head. Issue-required validation remains subject to the next independent review and GitHub CI.',
  });
  assert.equal(calls[0].options.cwd, '/worktree');
  assert.deepEqual(calls[1].args, ['status', '--porcelain=v1', '--untracked-files=all']);
  assert.deepEqual(calls[2].args, [
    'fetch', '--prune', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/ai/issue-274-repair:refs/remotes/origin/ai/issue-274-repair',
  ]);
});

test('fix worker refuses re-review when local worktree HEAD does not match the new PR head', () => {
  let recorded = false;
  assert.throws(() => validateFixedHead('/repo', managed(), fixJob(), {
    state: 'OPEN', headRefOid: newHead, baseRefName: 'main',
  }, {
    config: { baseBranch: 'main' },
    runState: { events: [] },
    runner(_command, args) {
      if (args[0] === 'rev-parse') return { ok: true, stdout: `${oldHead}\n`, stderr: '' };
      throw new Error('Validation should stop before any later git operation.');
    },
    recordValidation() { recorded = true; return { events: [] }; },
  }), /does not match the repaired PR head/);
  assert.equal(recorded, false);
});
