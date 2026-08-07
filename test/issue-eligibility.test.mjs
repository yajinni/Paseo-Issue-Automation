import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseIssueEligibility,
  evaluateIssueQueue,
  listIssueCandidates,
} from '../src/issue-eligibility.mjs';

const body = `## Objective\nDo the task.\n\n## Required behavior\nMake it work.\n\n## Acceptance criteria\nTests pass.\n\n## Validation and checks\nRun tests.\n\n## Stop conditions\nStop on destructive ambiguity.\n`;

function issue(number, { labels = ['paseo:ready'], blockedBy = [], state = 'OPEN', extra = {} } = {}) {
  return { number, title: `Issue ${number}`, body, labels: labels.map((name) => ({ name })), state, url: `https://example.test/issues/${number}`, blockedBy, ...extra };
}
function config(mode = 'recommended-labels', excludedLabels = []) { return { baseBranch: 'main', issueSelection: { mode, excludedLabels } }; }
function deps(ok = true, numbers = []) { return { ok, source: 'native', dependencies: numbers, unresolved: ok ? [] : numbers.map((number) => `Blocked by open issue #${number}.`) }; }
function isolated(extra = {}) { return { runLoader: () => null, claimed: () => false, recordInvalid() {}, restoreInvalid() {}, ...extra }; }

test('candidate source switches between recommended labels and all open issues while retaining rollout compatibility', () => {
  const calls = [];
  const jsonRunner = (_command, args) => { calls.push(args); return []; };
  listIssueCandidates('/repo', config('recommended-labels'), { jsonRunner, runLister: () => [] });
  listIssueCandidates('/repo', config('all-open'), { jsonRunner, runLister: () => [] });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes('paseo:ready'));
  assert.ok(calls[1].includes('agent-ready'));
  assert.equal(calls[2].includes('--label'), false);
});

test('blocked lowest-number candidate does not prevent the next eligible issue', () => {
  const waits = [];
  const result = evaluateIssueQueue('/repo', config(), isolated({
    issues: [issue(102), issue(101, { blockedBy: [{ number: 88 }] })],
    evaluateDependencies(_root, candidate) { return candidate.number === 101 ? deps(false, [88]) : deps(true); },
    recordWait(_root, candidate, dependency) { waits.push([candidate.number, dependency.dependencies]); },
    recordReady() {},
  }));
  assert.equal(result.next.issue.number, 102);
  assert.deepEqual(result.waiting, [{ issueNumber: 101, dependencies: [88], reasons: ['Blocked by open issue #88.'] }]);
  assert.deepEqual(waits, [[101, [88]]]);
});

test('when the lower issue becomes unblocked it returns to the front of the queue', () => {
  const result = evaluateIssueQueue('/repo', config(), isolated({ issues: [issue(102), issue(101)], evaluateDependencies: () => deps(true), recordReady() {} }));
  assert.deepEqual(result.eligible.map((entry) => entry.issue.number), [101, 102]);
});

test('all-open mode excludes configured labels, closed issues, pull requests, invalid contracts, and duplicate claims', () => {
  const invalid = issue(104); invalid.body = 'not the issue contract';
  const result = evaluateIssueQueue('/repo', config('all-open', ['do-not-run']), isolated({
    issues: [issue(100, { labels: [] }), issue(101, { labels: ['do-not-run'] }), issue(102, { labels: [], state: 'CLOSED' }), issue(103, { labels: [], extra: { isPullRequest: true } }), invalid, issue(105, { labels: [] })],
    claimed(_root, candidate) { return candidate.number === 105; },
    evaluateDependencies: () => deps(true), recordReady() {},
  }));
  assert.deepEqual(result.eligible.map((entry) => entry.issue.number), [100]);
  assert.deepEqual(result.rejected.map((entry) => [entry.issueNumber, entry.kind]), [[101, 'excluded-label'], [102, 'closed'], [103, 'pull-request'], [104, 'invalid-contract'], [105, 'duplicate-claim']]);
});

test('dependency waiting is local state only and requires no blocked lifecycle label', () => {
  const saved = [];
  evaluateIssueQueue('/repo', config(), isolated({ issues: [issue(7)], evaluateDependencies: () => deps(false, [3]), runSaver(_root, number, state) { saved.push([number, state]); return state; } }));
  assert.equal(saved[0][1].phase, 'waiting-for-dependencies');
  assert.equal(saved[0][1].blockType, 'dependency');
  assert.equal(JSON.stringify(saved[0][1]).includes('paseo:blocked'), false);
});

test('recommended mode accepts rollout-compatible agent-ready but rejects an issue with no ready label', () => {
  const options = { runLoader: () => null, claimed: () => false };
  assert.equal(baseIssueEligibility('/repo', issue(8, { labels: ['agent-ready'] }), config(), options).ok, true);
  const result = baseIssueEligibility('/repo', issue(9, { labels: [] }), config(), options);
  assert.equal(result.kind, 'not-ready');
});

test('corrected invalid issue can re-enter eligibility without deleting prior state', () => {
  let restored = false;
  const result = evaluateIssueQueue('/repo', config(), {
    issues: [issue(11, { labels: ['paseo:needs-attention'] })],
    runLoader: () => ({ phase: 'invalid-issue' }),
    claimed: () => false,
    evaluateDependencies: () => deps(true),
    restoreInvalid() { restored = true; },
    recordReady() {},
  });
  assert.equal(result.next.issue.number, 11);
  assert.equal(restored, true);
});
