import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAILED_ATTEMPT_RECOVERY_MAX,
  failedAttemptRecoveryEligibility,
  recoverFailedAttempt,
} from '../src/attempt-recovery.mjs';

test('failed attempt recovery reuses the same workspace, branch, attempt, and coder', () => {
  const calls = [];
  const spawns = [];
  let current = {
    issueNumber: 274,
    issueTitle: 'Reconcile accepted OpenSpec and rewrite status',
    status: 'agent-failed',
    phase: 'queued',
    restartPreviousPhase: 'failed',
    restartPreviousReason: 'Completion handoff could not be verified.',
    restartPending: true,
    branch: 'ai/issue-274-reconcile-accepted-openspec-and-rewrite-status-attempt-3',
    attempt: 3,
    workspaceId: 'wks_existing',
    worktreePath: '/worktrees/existing',
    workspaceTitle: 'ai/issue-274-reconcile-accepted-openspec-and-rewrite-status-attempt-3',
    workspaceName: 'ai/issue-274-reconcile-accepted-openspec-and-rewrite-status-attempt-3',
    coderAgentId: 'agent_existing',
    agentId: 'agent_existing',
    agentTitle: 'Issue #274 Coder (attempt 3)',
    activity: [],
    events: [],
  };

  const result = recoverFailedAttempt('/repo', 274, {
    readRun: () => current,
    writeRun: (_root, _number, next) => { current = next; return next; },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => {},
    inspectAgents: () => ({
      verified: true,
      reason: null,
      agents: [{ id: 'agent_existing', name: 'Issue #274 Coder (attempt 3)', cwd: '/worktrees/existing' }],
    }),
    runner: (command, args) => {
      calls.push([command, args]);
      return { ok: true, stdout: '', stderr: '' };
    },
    executable: '/node',
    workerPath: '/controller-worker.mjs',
    spawnFn: (command, args, options) => {
      spawns.push({ command, args, options });
      return { pid: 8877, unref() {} };
    },
  });

  assert.equal(result.recovered, true);
  assert.equal(result.attempt, 3);
  assert.equal(result.branch, 'ai/issue-274-reconcile-accepted-openspec-and-rewrite-status-attempt-3');
  assert.equal(result.workspaceId, 'wks_existing');
  assert.equal(result.coderAgentId, 'agent_existing');
  assert.equal(current.attempt, 3);
  assert.equal(current.workspaceId, 'wks_existing');
  assert.equal(current.coderAgentId, 'agent_existing');
  assert.equal(current.phase, 'recovering-failed-attempt');
  assert.equal(current.failedAttemptRecoveryCount, 1);
  assert.equal(current.controllerPid, 8877);

  const send = calls.find(([command, args]) => command === 'paseo' && args[0] === 'send');
  assert.ok(send);
  assert.deepEqual(send[1].slice(0, 3), ['send', 'agent_existing', '--no-wait']);
  assert.match(send[1][3], /do NOT start the task over/i);
  assert.match(send[1][3], /review the work already present/i);
  assert.match(send[1][3], /rerun every validation\/check required by the issue/i);
  assert.ok(!calls.some(([command, args]) => command === 'paseo' && args[0] === 'workspace' && ['create', 'archive'].includes(args[1])));

  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, '/node');
  assert.deepEqual(spawns[0].args, ['/controller-worker.mjs', '/repo', '274']);
  assert.equal(spawns[0].options.detached, true);
});

test('a failed attempt gets only one recover-first restart before fresh fallback', () => {
  const state = {
    status: 'paseo:failed',
    phase: 'failed',
    branch: 'ai/issue-274-attempt-3',
    workspaceId: 'wks_existing',
    worktreePath: '/worktrees/existing',
    coderAgentId: 'agent_existing',
    failedAttemptRecoveryCount: FAILED_ATTEMPT_RECOVERY_MAX,
  };
  const decision = failedAttemptRecoveryEligibility(state, { branchAction: 'keep' });
  assert.equal(decision.eligible, false);
  assert.match(decision.reason, /already used/i);
});

test('delete-branch restart explicitly bypasses recovery', () => {
  const state = {
    status: 'agent-failed',
    phase: 'failed',
    branch: 'ai/issue-274-attempt-3',
    workspaceId: 'wks_existing',
    worktreePath: '/worktrees/existing',
    coderAgentId: 'agent_existing',
  };
  const decision = failedAttemptRecoveryEligibility(state, { branchAction: 'delete' });
  assert.equal(decision.eligible, false);
  assert.match(decision.reason, /fresh attempt/i);
});

test('unsafe recorded workspace falls back without sending the old coder', () => {
  const calls = [];
  const state = {
    issueNumber: 274,
    status: 'agent-failed',
    phase: 'failed',
    branch: 'ai/issue-274-attempt-3',
    attempt: 3,
    workspaceId: 'wks_wrong',
    worktreePath: '/worktrees/wrong',
    coderAgentId: 'agent_existing',
    activity: [],
  };
  const result = recoverFailedAttempt('/repo', 274, {
    readRun: () => state,
    writeRun: () => { throw new Error('unsafe recovery must not mutate state'); },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => { throw new Error('wrong branch'); },
    inspectAgents: () => { throw new Error('should not inspect after identity failure'); },
    runner: (command, args) => {
      calls.push([command, args]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.recovered, false);
  assert.match(result.reason, /cannot be safely reused/i);
  assert.equal(calls.length, 0);
});
