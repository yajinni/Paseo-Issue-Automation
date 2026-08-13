import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeApprovedPullRequest } from '../src/approved-pr-finalization.mjs';
import { runConfiguredHarnessReview } from '../src/controller-review-workflow.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

const HEAD = 'abcdef1234567890';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-quick-review-race-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function seed(root) {
  return saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Guard quick review finalization',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'agent-running',
    phase: 'coding',
    branch: 'ai/issue-7-guard-quick-review',
    attempt: 1,
    workspaceId: 'workspace-7',
    worktreePath: path.join(root, 'managed-issue-worktree'),
    coderAgentId: 'coder-7',
    prNumber: 11,
    prUrl: 'https://example.invalid/octo/app/pull/11',
    events: [{ event: 'validation-summary', result: 'PASS', commit: HEAD, details: 'validated' }],
    activity: [],
  });
}

function snapshot(root) {
  return {
    state: loadRun(root, 7),
    head: HEAD,
    pr: {
      number: 11,
      url: 'https://example.invalid/octo/app/pull/11',
      isDraft: true,
      headRefOid: HEAD,
      headRefName: 'ai/issue-7-guard-quick-review',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
      state: 'OPEN',
    },
  };
}

function githubJson(command, args) {
  assert.equal(command, 'gh');
  if (args[0] === 'repo') return { nameWithOwner: 'octo/app' };
  if (args[0] === 'issue') return {
    number: 7,
    title: 'Guard quick review finalization',
    body: 'Do not merge before full review.',
    url: 'https://example.invalid/octo/app/issues/7',
    comments: [],
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
  };
  if (args[0] === 'pr') return snapshotRootPr();
  throw new Error(`Unexpected gh call: ${args.join(' ')}`);
}

function snapshotRootPr() {
  return {
    number: 11,
    state: 'OPEN',
    isDraft: true,
    headRefOid: HEAD,
    headRefName: 'ai/issue-7-guard-quick-review',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    url: 'https://example.invalid/octo/app/pull/11',
  };
}

function config(workflow) {
  return {
    baseBranch: 'main',
    codingHarness: 'fixture',
    review: { workflow, quickMaxRounds: 3, fullMaxRounds: 3, autoMergeApproved: true },
    maxReviewRounds: 3,
    models: { reviewer: 'fixture/reviewer', reviewerThinking: 'high' },
  };
}

function auditRunner() {
  return { ok: true, stdout: '', stderr: '' };
}

test('quick pass cannot authorize auto-merge before required full staged review', (t) => {
  const root = repository(t);
  seed(root);
  const review = runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config('quick-web-chatgpt'),
    jsonRunner: githubJson,
    auditRunner,
    agentRunner() {
      return { result: 'pass', summary: 'Light review passed.', findings: [] };
    },
  });

  assert.equal(review.decision.action, 'quick-passed');
  const state = loadRun(root, 7);
  const compatibility = state.events.find((event) => event.event === 'review');
  assert.equal(compatibility?.result, 'APPROVED');
  assert.equal(compatibility?.source, 'harness-review-light-compat');
  assert.equal(state.events.some((event) => event.event === 'review' && event.source === 'harness-review-compat'), false);

  assert.throws(() => finalizeApprovedPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: state.issueUrl,
    pullRequest: { ...snapshotRootPr(), isDraft: false },
    state,
    approvalSource: 'full-review',
  }, { config: config('quick-web-chatgpt') }), /No authoritative exact-head approval exists/);
});

test('full harness pass keeps authoritative compatibility source', (t) => {
  const root = repository(t);
  seed(root);
  const review = runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config('full-immediate'),
    jsonRunner: githubJson,
    auditRunner,
    agentRunner() {
      return { result: 'pass', summary: 'Full review passed.', findings: [] };
    },
  });

  assert.equal(review.decision.action, 'full-passed');
  const state = loadRun(root, 7);
  const compatibility = state.events.find((event) => event.event === 'review');
  assert.equal(compatibility?.source, 'harness-review-compat');
});
