import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_REVIEW_ACTIONS,
  enterManualReview,
  evaluateManualReviewSnapshot,
  manualReviewCapabilities,
  renderManualFallbackAudit,
  renderManualReviewHandoff,
  resumeManualReviewAfterRepair,
} from '../src/manual-review-lifecycle.mjs';

function fakeRunner(calls, results = []) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return results.shift() || { ok: true, stdout: '', stderr: '' };
  };
}

test('manual handoff marks a draft ready and posts exact-head validation plus unresolved quick findings', () => {
  const calls = [];
  const result = enterManualReview('/repo', {
    pullRequestNumber: 41,
    headSha: 'abcdef1234567890',
    validationSummary: 'Node 20/22/24 passed.',
    quickExhausted: true,
    quickFindings: [
      { severity: 'blocking', message: 'Recheck edge case.', file: 'src/a.mjs', line: 8 },
      { severity: 'non-blocking', message: 'Optional wording.' },
    ],
  }, { runner: fakeRunner(calls) });
  assert.equal(result.state, MANUAL_REVIEW_ACTIONS.waiting);
  assert.equal(result.automaticMergeAllowed, false);
  assert.deepEqual(calls[0].args, ['pr', 'ready', '41']);
  assert.deepEqual(calls[1].args.slice(0, 3), ['pr', 'comment', '41']);
  assert.match(calls[1].args[4], /abcdef1234567890/);
  assert.match(calls[1].args[4], /Node 20\/22\/24 passed/);
  assert.match(calls[1].args[4], /Recheck edge case/);
  assert.doesNotMatch(calls[1].args[4], /Optional wording/);
});

test('already-ready PR skips the ready mutation but still posts the handoff', () => {
  const calls = [];
  enterManualReview('/repo', {
    pullRequestNumber: 41,
    headSha: 'abcdef1234567890',
    isDraft: false,
  }, { runner: fakeRunner(calls) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'comment', '41']);
});

test('stale review events never advance manual review state', () => {
  assert.deepEqual(evaluateManualReviewSnapshot({
    expectedHeadSha: 'abcdef1',
    pr: { state: 'OPEN', headRefOid: 'deadbee', reviewDecision: 'APPROVED' },
  }), {
    action: MANUAL_REVIEW_ACTIONS.stale,
    complete: false,
    reason: 'The PR head changed after manual review was requested.',
  });
});

test('changes requested queues fixes on the same PR and approval does not enable auto merge', () => {
  const changes = evaluateManualReviewSnapshot({
    expectedHeadSha: 'abcdef1',
    pr: {
      state: 'OPEN',
      headRefOid: 'abcdef1',
      reviews: [{ state: 'CHANGES_REQUESTED', commitId: 'abcdef1', submittedAt: '2026-08-07T01:00:00Z' }],
    },
  });
  assert.equal(changes.action, MANUAL_REVIEW_ACTIONS.queueFix);
  assert.equal(changes.samePullRequestRequired, true);

  const approved = evaluateManualReviewSnapshot({
    expectedHeadSha: 'abcdef1',
    pr: {
      state: 'OPEN',
      headRefOid: 'abcdef1',
      reviews: [{ state: 'APPROVED', commitId: 'abcdef1', submittedAt: '2026-08-07T02:00:00Z' }],
    },
  });
  assert.equal(approved.action, MANUAL_REVIEW_ACTIONS.approved);
  assert.equal(approved.complete, true);
  assert.equal(approved.automaticMergeAllowed, false);
});

test('manual merge completes while closed-unmerged remains incomplete and needs attention', () => {
  assert.deepEqual(evaluateManualReviewSnapshot({
    expectedHeadSha: 'abcdef1',
    pr: { state: 'MERGED', mergedAt: '2026-08-07T02:00:00Z', headRefOid: 'abcdef1' },
  }), { action: MANUAL_REVIEW_ACTIONS.merged, complete: true, headSha: 'abcdef1' });
  assert.deepEqual(evaluateManualReviewSnapshot({
    expectedHeadSha: 'abcdef1',
    pr: { state: 'CLOSED', headRefOid: 'abcdef1' },
  }), { action: MANUAL_REVIEW_ACTIONS.closedUnmerged, complete: false, needsAttention: true });
});

test('after a repair manual review resumes only after validation passes on the new exact head', () => {
  assert.deepEqual(resumeManualReviewAfterRepair({
    previousHeadSha: 'abcdef1',
    currentHeadSha: 'bcdefa2',
    validationCommit: 'bcdefa2',
    validationPassed: true,
  }), {
    ready: true,
    state: MANUAL_REVIEW_ACTIONS.waiting,
    headSha: 'bcdefa2',
    automaticMergeAllowed: false,
  });
  assert.deepEqual(resumeManualReviewAfterRepair({
    previousHeadSha: 'abcdef1',
    currentHeadSha: 'bcdefa2',
    validationCommit: 'abcdef1',
    validationPassed: true,
  }), { ready: false, reason: 'The repaired exact head has not passed validation.' });
});

test('fallback actions are explicit and auditable with actor time and source', () => {
  const audit = renderManualFallbackAudit({
    action: 'send-back-for-changes',
    actor: 'octocat',
    source: 'manager-dashboard',
    at: '2026-08-07T03:00:00Z',
    reason: 'Acceptance criterion 3 is missing.',
  });
  assert.match(audit, /paseo-manual-review-action:v1/);
  assert.match(audit, /octocat/);
  assert.match(audit, /manager-dashboard/);
  assert.match(audit, /2026-08-07T03:00:00Z/);
  assert.match(audit, /Acceptance criterion 3/);
  assert.deepEqual(manualReviewCapabilities(), {
    automaticMerge: false,
    fallbackActions: ['send-back-for-changes', 'mark-manual-review-complete'],
  });
});

test('handoff renderer requires exact head identity', () => {
  assert.throws(() => renderManualReviewHandoff({ headSha: '' }), /exact head SHA/);
});
