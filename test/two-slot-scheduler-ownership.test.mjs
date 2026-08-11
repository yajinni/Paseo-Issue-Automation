import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { activeCodingCount } from '../src/fix-jobs.mjs';
import { dispatchAvailableIssues } from '../src/dispatch-batch.mjs';
import { listRuns, loadRun, saveConfig, saveRun, saveRuntime } from '../src/state.mjs';

const ACTIVE_STATUS = 'agent-running';
const RELEASED_STATUS = 'completed';
const STARTED_AT = '2026-08-11T00:00:00.000Z';
const RELEASED_AT = '2026-08-11T00:01:00.000Z';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-two-slot-ownership-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  saveConfig(root, {
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 60,
    maxActive: 2,
    codingHarness: 'acceptance',
    issueSelection: { mode: 'all-open', excludedLabels: [], temporaryFailureRetries: 0 },
    review: { workflow: 'quick-manual', quickMaxRounds: 1, fullMaxRounds: 1, autoMergeApproved: false },
    models: {
      orchestrator: 'acceptance/orchestrator',
      coder: 'acceptance/coder',
      coderThinking: 'medium',
      reviewer: 'acceptance/reviewer',
      reviewerThinking: 'medium',
    },
  });
  saveRuntime(root, { claimsEnabled: true, skippedIssueNumbers: [] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function issueFixtures(root) {
  return [101, 102, 103].map((issueNumber) => ({
    issueNumber,
    issueTitle: `Concurrent acceptance issue ${issueNumber}`,
    branch: `ai/issue-${issueNumber}-concurrent-acceptance`,
    workspaceId: `workspace-${issueNumber}`,
    worktreePath: path.join(root, `worktree-${issueNumber}`),
    coderAgentId: `coder-${issueNumber}`,
    controllerPid: 10_000 + issueNumber,
  }));
}

function activeStates(root) {
  return listRuns(root).filter((state) => state.status === ACTIVE_STATUS);
}

function activeCount(root) {
  return activeCodingCount(root, {
    // This is the deterministic stand-in for the GitHub coding-label query.
    jsonRunner: () => activeStates(root).map((state) => ({ number: state.issueNumber })),
    storeLoader: () => ({ fixJobs: [] }),
  });
}

function createDispatcher(root) {
  const fixtures = issueFixtures(root);
  const calls = [];

  function dispatchIssue() {
    const fixture = fixtures.find(({ issueNumber }) => !loadRun(root, issueNumber));
    if (!fixture) return { claimed: false, reason: 'No eligible issue found.' };

    calls.push(fixture.issueNumber);
    saveRun(root, fixture.issueNumber, {
      issueNumber: fixture.issueNumber,
      issueTitle: fixture.issueTitle,
      branch: fixture.branch,
      attempt: 1,
      status: ACTIVE_STATUS,
      phase: 'coding',
      workspaceId: fixture.workspaceId,
      worktreePath: fixture.worktreePath,
      coderAgentId: fixture.coderAgentId,
      agentId: fixture.coderAgentId,
      controllerPid: fixture.controllerPid,
      startedAt: STARTED_AT,
      heartbeatAt: STARTED_AT,
      completedAt: null,
      activity: [],
      events: [],
    });
    return {
      claimed: true,
      issueNumber: fixture.issueNumber,
      branch: fixture.branch,
      attempt: 1,
      workspaceId: fixture.workspaceId,
      controllerPid: fixture.controllerPid,
    };
  }

  return { calls, dispatchIssue, fixtures };
}

function dispatch(root, dispatchIssue) {
  return dispatchAvailableIssues(root, {
    dispatchIssue,
    activeCount: () => activeCount(root),
    // PR fixes are outside this acceptance boundary.
    dispatchFix: () => ({ claimed: false }),
  });
}

function assertOwnership(root, issueNumbers, fixtures) {
  const active = activeStates(root);
  assert.deepEqual(active.map((state) => state.issueNumber).sort((a, b) => a - b), issueNumbers);

  for (const field of ['branch', 'workspaceId', 'coderAgentId', 'controllerPid']) {
    assert.equal(new Set(active.map((state) => state[field])).size, active.length, `${field} must be unique`);
  }

  assert.deepEqual(active.map((state) => ({
    issueNumber: state.issueNumber,
    branch: state.branch,
    workspaceId: state.workspaceId,
    coderAgentId: state.coderAgentId,
    controllerPid: state.controllerPid,
  })).sort((left, right) => left.issueNumber - right.issueNumber), issueNumbers.map((issueNumber) => {
    const fixture = fixtures.find((item) => item.issueNumber === issueNumber);
    return {
      issueNumber,
      branch: fixture.branch,
      workspaceId: fixture.workspaceId,
      coderAgentId: fixture.coderAgentId,
      controllerPid: fixture.controllerPid,
    };
  }));
}

test('two-slot coding scheduler admits, releases, and reconciles isolated persisted ownership', (t) => {
  const root = repository(t);
  const { calls, dispatchIssue, fixtures } = createDispatcher(root);

  const first = dispatch(root, dispatchIssue);
  assert.equal(first.claimed, true);
  assert.deepEqual(first.attempts.map((attempt) => attempt.issueNumber), [101, 102]);
  assert.equal(activeCount(root), 2);
  assert.equal(loadRun(root, 103), null, 'the third eligible issue must remain waiting');
  assertOwnership(root, [101, 102], fixtures);

  const restartPass = dispatch(root, dispatchIssue);
  assert.equal(restartPass.claimed, false);
  assert.deepEqual(calls, [101, 102], 'a reconciliation pass must not duplicate active dispatches');
  assertOwnership(root, [101, 102], fixtures);

  const released = loadRun(root, 101);
  saveRun(root, 101, {
    ...released,
    status: RELEASED_STATUS,
    phase: RELEASED_STATUS,
    completedAt: RELEASED_AT,
    heartbeatAt: null,
  });
  assert.equal(activeCount(root), 1);
  assert.equal(loadRun(root, 101).completedAt, RELEASED_AT);

  const afterRelease = dispatch(root, dispatchIssue);
  assert.equal(afterRelease.claimed, true);
  assert.deepEqual(afterRelease.attempts.map((attempt) => attempt.issueNumber), [103]);
  assert.deepEqual(calls, [101, 102, 103]);
  assert.equal(activeCount(root), 2);
  assertOwnership(root, [102, 103], fixtures);

  const finalReconciliation = dispatch(root, dispatchIssue);
  assert.equal(finalReconciliation.claimed, false);
  assert.deepEqual(calls, [101, 102, 103]);
  assertOwnership(root, [102, 103], fixtures);
});
