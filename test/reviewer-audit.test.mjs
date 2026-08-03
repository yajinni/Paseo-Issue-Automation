import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatReviewerAuditComment,
  postReviewerAuditComment,
} from '../src/reviewer-audit.mjs';

test('Reviewer audit comment records exact PR, commit, round, verdict, and findings', () => {
  const body = formatReviewerAuditComment({
    issueNumber: 12,
    prNumber: 34,
    commit: 'abc123',
    round: 2,
    approved: false,
    findings: '- Fix the authorization boundary.',
  });
  assert.match(body, /Issue: #12/);
  assert.match(body, /PR: #34/);
  assert.match(body, /`abc123`/);
  assert.match(body, /Review round: 2/);
  assert.match(body, /CHANGES_REQUIRED/);
  assert.match(body, /Fix the authorization boundary/);
});

test('approved audit comments include a stable default finding', () => {
  const body = formatReviewerAuditComment({
    issueNumber: 1,
    prNumber: 2,
    commit: 'def456',
    round: 1,
    approved: true,
    findings: '',
  });
  assert.match(body, /APPROVED/);
  assert.match(body, /approved this exact validated commit/i);
});

test('posting Reviewer audit uses a PR comment and fails closed', () => {
  const calls = [];
  const result = postReviewerAuditComment('/repo', {
    issueNumber: 5,
    prNumber: 8,
    commit: 'fedcba',
    round: 3,
    approved: true,
    findings: 'All requirements satisfied.',
  }, {
    runner(command, args, options) {
      calls.push({ command, args, options });
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.verdict, 'APPROVED');
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'comment', '8']);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.throws(() => postReviewerAuditComment('/repo', {
    issueNumber: 5,
    prNumber: 8,
    commit: 'fedcba',
    round: 3,
    approved: false,
    findings: 'Needs changes.',
  }, {
    runner: () => ({ ok: false, stderr: 'permission denied', stdout: '' }),
  }), /Could not write Reviewer audit comment.*permission denied/);
});
