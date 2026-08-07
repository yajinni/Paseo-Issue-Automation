import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVALID_ISSUE_COMMENT_MARKER,
  invalidIssueFeedbackBody,
  recordInvalidIssueAttention,
  restoreCorrectedIssue,
} from '../src/issue-attention.mjs';

function issue(labels = ['paseo:ready']) {
  return { number: 17, title: 'Needs contract', url: 'https://example.test/17', labels: labels.map((name) => ({ name })) };
}
const contract = {
  reason: 'Objective is required. Stop conditions must contain meaningful content.',
  missingFields: [{ field: 'Objective', code: 'missing-section', message: 'Objective is required.' }],
  invalidFields: [{ field: 'Stop conditions', code: 'empty-section', message: 'Stop conditions must contain meaningful content.' }],
};
const config = { issueSelection: { mode: 'recommended-labels' } };

test('feedback body identifies invalid sections and carries one stable dedupe marker', () => {
  const body = invalidIssueFeedbackBody(contract);
  assert.match(body, /Objective/);
  assert.match(body, /Stop conditions/);
  assert.equal((body.match(/paseo:invalid-issue-feedback/g) || []).length, 1);
  assert.ok(body.startsWith(INVALID_ISSUE_COMMENT_MARKER));
});

test('invalid issue gets needs-attention, loses ready, and preserves one feedback comment identity', () => {
  const saves = [];
  const edits = [];
  const comments = [];
  const result = recordInvalidIssueAttention('/repo', issue(), contract, config, {
    loadRun: () => null,
    saveRun(_root, _number, state) { saves.push(state); return state; },
    upsertComment(_root, number, body) { comments.push([number, body]); return { id: 123, changed: true }; },
    editLabels(_root, candidate) { edits.push(candidate); return { ok: true, readyLabel: 'paseo:ready' }; },
  });
  assert.equal(result.state.status, 'paseo:needs-attention');
  assert.equal(result.state.phase, 'invalid-issue');
  assert.equal(result.state.invalidIssueCommentId, 123);
  assert.equal(result.state.readyLabelBeforeAttention, 'paseo:ready');
  assert.equal(comments.length, 1);
  assert.equal(edits.length, 1);
  assert.equal(saves.length, 1);
});

test('corrected issue restores readiness without deleting invalid history', () => {
  const previous = {
    issueNumber: 17,
    phase: 'invalid-issue',
    status: 'paseo:needs-attention',
    readyLabelBeforeAttention: 'paseo:ready',
    activity: [{ type: 'invalid-issue-attention', at: '2026-01-01T00:00:00Z', details: 'bad' }],
  };
  const result = restoreCorrectedIssue('/repo', issue(['paseo:needs-attention']), config, {
    loadRun: () => previous,
    saveRun(_root, _number, state) { return state; },
    editLabels() { return { ok: true, readyLabel: 'paseo:ready' }; },
  });
  assert.equal(result.phase, 'ready');
  assert.equal(result.reason, null);
  assert.equal(result.activity[0].type, 'invalid-issue-attention');
  assert.equal(result.activity.at(-1).type, 'invalid-issue-corrected');
});
