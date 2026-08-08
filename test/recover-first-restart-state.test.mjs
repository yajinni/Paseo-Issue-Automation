import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverFailedAttempt } from '../src/attempt-recovery.mjs';
import { LEGACY_LABELS } from '../src/label-catalog.mjs';

test('recover-first clears restart ownership before spawning the resumed controller', () => {
  let current = {
    issueNumber: 303,
    attempt: 4,
    status: LEGACY_LABELS.failed,
    phase: 'starting-agent',
    restartPending: true,
    restartRequestedAt: '2026-08-08T20:00:00.000Z',
    restartPreviousPhase: 'failed',
    branch: 'ai/issue-303-recover-first-attempt-4',
    workspaceId: 'workspace-303',
    worktreePath: '/tmp/recover-first',
    workspaceName: 'ai/issue-303-recover-first-attempt-4',
    coderAgentId: 'coder-303',
    agentId: 'coder-303',
    activity: [],
  };
  let spawned = false;

  const result = recoverFailedAttempt('/repo', 303, {
    readRun: () => current,
    writeRun: (_root, _number, state) => {
      current = state;
      return state;
    },
    configLoader: () => ({ baseBranch: 'main' }),
    runner: (command) => ({ ok: command === 'paseo' || command === 'gh', stdout: '', stderr: '' }),
    verifyWorkspace: () => {},
    inspectAgents: () => ({
      verified: true,
      agents: [{ id: 'coder-303', cwd: '/tmp/recover-first', name: 'Issue #303 Coder (attempt 4)' }],
    }),
    spawnFn: () => {
      spawned = true;
      assert.equal(current.restartPending, false);
      assert.equal(current.restartRequestedAt, null);
      assert.equal(current.phase, 'recovering-failed-attempt');
      return { pid: 4321, unref() {} };
    },
    executable: '/node',
    workerPath: '/controller-worker.mjs',
  });

  assert.equal(spawned, true);
  assert.equal(result.recovered, true);
  assert.equal(result.attempt, 4);
  assert.equal(current.restartPending, false);
  assert.equal(current.controllerPid, 4321);
});
