import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverFailedAttempt } from '../src/attempt-recovery.mjs';

function okResult() {
  return { ok: true, exitCode: 0, stdout: '', stderr: '' };
}

test('recover-first parent never overwrites a controller terminal state after spawn', () => {
  let currentState = {
    issueNumber: 303,
    attempt: 4,
    status: 'agent-failed',
    phase: 'failed',
    reason: 'Previous controller failed.',
    branch: 'ai/issue-303-recover-first-attempt-4',
    worktreePath: '/tmp/recover-first-worktree',
    workspaceId: 'workspace-303',
    workspaceTitle: 'ai/issue-303-recover-first-attempt-4',
    workspaceName: 'ai/issue-303-recover-first-attempt-4',
    coderAgentId: 'coder-303',
    agentId: 'coder-303',
    activity: [],
  };
  const writes = [];

  const result = recoverFailedAttempt('/tmp/recover-first-root', 303, {
    readRun: () => currentState,
    writeRun: (_root, _issue, next) => {
      writes.push(next);
      currentState = next;
      return next;
    },
    configLoader: () => ({ baseBranch: 'main' }),
    runner: () => okResult(),
    inspectAgents: () => ({
      verified: true,
      agents: [{ id: 'coder-303', name: 'Issue #303 Coder (attempt 4)' }],
    }),
    verifyWorkspace: () => ({ verified: true }),
    spawnFn: () => {
      currentState = {
        ...currentState,
        status: 'agent-failed',
        phase: 'failed',
        reason: 'simulated immediate controller failure',
        completedAt: '2026-08-08T22:00:00.000Z',
        controllerPid: null,
      };
      return { pid: 4242, unref() {} };
    },
    executable: process.execPath,
    workerPath: '/tmp/recovery-controller-worker.mjs',
  });

  assert.equal(result.recovered, true);
  assert.equal(result.controllerPid, 4242);
  assert.equal(writes.length, 1, 'the recovery parent must not persist state after the controller is spawned');
  assert.equal(currentState.phase, 'failed');
  assert.equal(currentState.status, 'agent-failed');
  assert.equal(currentState.reason, 'simulated immediate controller failure');
  assert.equal(currentState.completedAt, '2026-08-08T22:00:00.000Z');
});
