import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeApprovedPullRequest } from '../src/approved-pr-finalization.mjs';
import { saveRun } from '../src/state.mjs';

const HEAD = 'abcdef1234567890';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-finalization-guards-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function approvedState(root, overrides = {}) {
  return saveRun(root, 7, {
    issueNumber: 7,
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'agent-running',
    phase: 'finalizing-approved-pr',
    branch: 'ai/issue-7-finalize',
    prNumber: 11,
    prUrl: 'https://example.invalid/octo/app/pull/11',
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD },
      { event: 'harness-review', stage: 'full', result: 'pass', headSha: HEAD, findings: [] },
    ],
    activity: [],
    ...overrides,
  });
}

function pr(overrides = {}) {
  return {
    number: 11,
    url: 'https://example.invalid/octo/app/pull/11',
    state: 'OPEN',
    isDraft: false,
    headRefOid: HEAD,
    headRefName: 'ai/issue-7-finalize',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

function config(autoMergeApproved = true) {
  return {
    baseBranch: 'main',
    review: { workflow: 'full-immediate', autoMergeApproved },
  };
}

test('wrong configured base blocks automatic merge even when the PR is otherwise approved', (t) => {
  const root = repository(t);
  const state = approvedState(root);
  let autoMergeCalls = 0;
  const result = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: pr({ baseRefName: 'release' }),
    state,
  }, {
    config: config(true),
    humanFinalizer() { return approvedState(root, { phase: 'human-review', approvedCommit: HEAD }); },
    autoMergeRequester() { autoMergeCalls += 1; return { enabled: true }; },
  });

  assert.equal(result.mode, 'human-review');
  assert.equal(result.autoMergeUnavailable, true);
  assert.equal(result.eligibility.eligible, false);
  assert.equal(autoMergeCalls, 0);
});

test('settled human fallback does not retry draft readiness or human finalization', (t) => {
  const root = repository(t);
  const state = approvedState(root, { phase: 'human-review', approvedCommit: HEAD });
  const result = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: pr({ isDraft: true }),
    state,
  }, {
    config: config(false),
    runner() { throw new Error('settled human fallback must not call GitHub'); },
    humanFinalizer() { throw new Error('settled human fallback must not finalize twice'); },
  });

  assert.equal(result.mode, 'human-review');
  assert.equal(result.unchanged, true);
  assert.equal(result.readiness.skipped, true);
});
