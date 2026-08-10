import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  finalizeApprovedPullRequest,
  prepareManagedFinalizationEvidence,
  repositoryAutoMergeCapability,
} from '../src/approved-pr-finalization.mjs';
import { registerManualReviewPullRequest } from '../src/manual-review-reconcile.mjs';
import { findManaged, loadPrReviewStore } from '../src/pr-review-store.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

const HEAD = 'abcdef1234567890';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-approved-finalization-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function config(overrides = {}) {
  return {
    baseBranch: 'main',
    review: {
      workflow: 'full-immediate',
      autoMergeApproved: true,
      ...overrides,
    },
  };
}

function approvedRun(root, overrides = {}) {
  return saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Finalization fixture',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'agent-running',
    phase: 'reviewing-heavy',
    reviewRuntimeStage: 'full',
    branch: 'ai/issue-7-finalize',
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    prNumber: 11,
    prUrl: 'https://example.invalid/octo/app/pull/11',
    completedAt: null,
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD, details: 'validated' },
      { event: 'harness-review', stage: 'full', round: 1, result: 'pass', headSha: HEAD, findings: [] },
    ],
    activity: [],
    ...overrides,
  });
}

function approvedPr(overrides = {}) {
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

function managedForIssue(root) {
  const store = loadPrReviewStore(root);
  return store.managedPullRequests.find((managed) => managed.issueNumber === 7);
}

test('repository auto-merge capability reports the actual GitHub setting', () => {
  const disabled = repositoryAutoMergeCapability('/repo', 'octo/app', {
    runner(command, args) {
      assert.equal(command, 'gh');
      assert.deepEqual(args, ['api', 'repos/octo/app', '--jq', '.allow_auto_merge']);
      return { ok: true, stdout: 'false\n', stderr: '' };
    },
  });
  assert.deepEqual(disabled, {
    known: true,
    enabled: false,
    reason: 'GitHub repository auto-merge is disabled.',
  });
});

test('repository-level auto-merge disabled falls back to visible human review without bypassing policy', (t) => {
  const root = repository(t);
  const state = approvedRun(root);
  let humanCalls = 0;
  let autoMergeCalls = 0;
  const result = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: approvedPr(),
    state,
    approvalSource: 'harness-review',
  }, {
    config: config(),
    runner(command, args) {
      if (command === 'gh' && args[0] === 'api') return { ok: true, stdout: 'false\n', stderr: '' };
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    autoMergeRequester() {
      autoMergeCalls += 1;
      return { enabled: true };
    },
    humanFinalizer() {
      humanCalls += 1;
      return loadRun(root, 7);
    },
  });

  assert.equal(result.mode, 'human-review');
  assert.equal(result.autoMergeUnavailable, true);
  assert.match(result.reason, /repository auto-merge is disabled/i);
  assert.equal(humanCalls, 1);
  assert.equal(autoMergeCalls, 0);
  const managed = managedForIssue(root);
  assert.equal(managed.reviewState, 'ready_to_merge');
  assert.equal(managed.lastCompletedReviewSha, HEAD);
  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.filter((job) => job.state === 'completed' && job.result === 'approved').length, 1);
});

test('eligible approval requests GitHub auto-merge once and leaves lifecycle pending until merge reconciliation', (t) => {
  const root = repository(t);
  const state = approvedRun(root);
  let requestCalls = 0;
  const commands = [];
  const options = {
    config: config(),
    runner(command, args) {
      commands.push([command, ...args]);
      if (command === 'gh' && args[0] === 'api') return { ok: true, stdout: 'true\n', stderr: '' };
      if (command === 'gh' && args[0] === 'issue' && args[1] === 'edit') return { ok: true, stdout: '', stderr: '' };
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    autoMergeRequester() {
      requestCalls += 1;
      return { requested: true, enabled: true, reason: null };
    },
    humanFinalizer() {
      throw new Error('Human finalization should not run.');
    },
  };

  const first = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: approvedPr(),
    state,
    approvalSource: 'harness-review',
  }, options);
  assert.equal(first.mode, 'auto-merge');
  assert.equal(first.enabled, true);
  assert.equal(requestCalls, 1);
  const saved = loadRun(root, 7);
  assert.equal(saved.phase, 'auto-merge-requested');
  assert.equal(saved.approvedCommit, HEAD);
  assert.equal(saved.completedAt, null);
  assert.ok(commands.some((args) => args[0] === 'gh' && args[1] === 'issue' && args[2] === 'edit'));

  const second = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: approvedPr(),
    state: loadRun(root, 7),
    approvalSource: 'harness-review',
  }, options);
  assert.equal(second.mode, 'auto-merge');
  assert.equal(second.unchanged, true);
  assert.equal(requestCalls, 1);
});

test('auto-merge policy disabled routes an approved draft to human review and marks it ready', (t) => {
  const root = repository(t);
  const state = approvedRun(root);
  const calls = [];
  let humanCalls = 0;
  const result = finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: approvedPr({ isDraft: true }),
    state,
    approvalSource: 'harness-review',
  }, {
    config: config({ autoMergeApproved: false }),
    runner(command, args) {
      calls.push([command, ...args]);
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'ready') return { ok: true, stdout: '', stderr: '' };
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    humanFinalizer() {
      humanCalls += 1;
      return loadRun(root, 7);
    },
  });
  assert.equal(result.mode, 'human-review');
  assert.equal(humanCalls, 1);
  assert.deepEqual(calls[0], ['gh', 'pr', 'ready', '11']);
});

test('manual merge creates durable exact-head completion evidence without enabling automatic merge', (t) => {
  const root = repository(t);
  saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Manual finalization fixture',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'paseo:review-queued',
    phase: 'manual-review-merged-pending-finalization',
    reviewRuntimeStage: 'full-manual',
    reviewExpectedHeadSha: HEAD,
    branch: 'ai/issue-7-finalize',
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    prNumber: 11,
    prUrl: 'https://example.invalid/octo/app/pull/11',
    events: [{ event: 'validation-summary', result: 'PASS', commit: HEAD, details: 'validated' }],
    activity: [],
  });
  const registered = registerManualReviewPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    pullRequestNumber: 11,
    pullRequestUrl: 'https://example.invalid/octo/app/pull/11',
    branchName: 'ai/issue-7-finalize',
    worktreePath: root,
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    currentHeadSha: HEAD,
    reviewRound: 1,
  });
  assert.equal(registered.reviewState, 'paused');

  const prepared = prepareManagedFinalizationEvidence(root);
  assert.equal(prepared.length, 1);
  const store = loadPrReviewStore(root);
  const managed = findManaged(store, registered.id);
  assert.equal(managed.reviewState, 'ready_to_merge');
  assert.equal(managed.lastCompletedReviewSha, HEAD);
  assert.equal(store.reviewJobs.filter((job) => job.result === 'approved' && job.headSha === HEAD).length, 1);
});
