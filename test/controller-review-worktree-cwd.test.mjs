import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runConfiguredHarnessReview } from '../src/controller-review-workflow.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-review-worktree-cwd-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function config() {
  return {
    baseBranch: 'main',
    codingHarness: 'fixture',
    review: { workflow: 'quick-manual', quickMaxRounds: 3, fullMaxRounds: 3, autoMergeApproved: false },
    maxReviewRounds: 3,
    models: { reviewer: 'fixture/reviewer', reviewerThinking: 'high' },
  };
}

function initialRun(root, overrides = {}) {
  const worktreePath = path.join(root, 'managed-issue-worktree');
  return saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Fix reviewer cwd',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'agent-running',
    phase: 'coding',
    branch: 'ai/issue-7-fix-reviewer-cwd',
    attempt: 1,
    workspaceId: 'workspace-7',
    worktreePath,
    coderAgentId: 'coder-7',
    events: [{
      event: 'validation-summary',
      result: 'PASS',
      commit: 'abcdef1234567890',
      details: 'Exact-head validation passed.',
      at: '2026-08-12T14:00:00Z',
    }],
    activity: [],
    ...overrides,
  });
}

function snapshot(root) {
  return {
    state: loadRun(root, 7),
    head: 'abcdef1234567890',
    pr: {
      number: 11,
      url: 'https://example.invalid/octo/app/pull/11',
      isDraft: true,
      headRefOid: 'abcdef1234567890',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    },
  };
}

function exactVerdict() {
  return {
    repository: 'octo/app',
    pullRequestNumber: 11,
    issueNumber: 7,
    headSha: 'abcdef1234567890',
    stage: 'quick',
    round: 1,
    promptVersion: 1,
    result: 'pass',
    summary: 'Looks good.',
    findings: [],
  };
}

function githubJson(command, args) {
  assert.equal(command, 'gh');
  if (args[0] === 'repo') return { nameWithOwner: 'octo/app' };
  if (args[0] === 'issue') return {
    number: 7,
    title: 'Fix reviewer cwd',
    body: 'Review the managed issue worktree.',
    url: 'https://example.invalid/octo/app/issues/7',
    comments: [],
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
  };
  if (args[0] === 'pr') return {
    number: 11,
    state: 'OPEN',
    isDraft: true,
    headRefOid: 'abcdef1234567890',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    url: 'https://example.invalid/octo/app/pull/11',
  };
  throw new Error(`Unexpected gh call: ${args.join(' ')}`);
}

function auditRunner() {
  return { ok: true, stdout: '', stderr: '' };
}

test('staged reviewer binds the exact managed workspace and issue worktree cwd', (t) => {
  const root = repository(t);
  const state = initialRun(root);
  const calls = [];

  runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config(),
    jsonRunner: githubJson,
    auditRunner,
    agentRunner(command, args, options) {
      calls.push({ command, args, options });
      return exactVerdict();
    },
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, 'paseo');
  assert.equal(call.options.cwd, root, 'controller subprocess can still be launched from the repository root');
  assert.equal(call.args[call.args.indexOf('--workspace') + 1], state.workspaceId);
  assert.equal(call.args[call.args.indexOf('--cwd') + 1], state.worktreePath);
  assert.notEqual(state.worktreePath, root);
});

test('staged reviewer fails closed before dispatch when managed worktree identity is incomplete', (t) => {
  const root = repository(t);
  initialRun(root, { worktreePath: null });
  let dispatched = false;

  assert.throws(() => runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config(),
    jsonRunner: githubJson,
    auditRunner,
    agentRunner() {
      dispatched = true;
      return exactVerdict();
    },
  }), /managed workspaceId and worktreePath/);

  assert.equal(dispatched, false);
});
