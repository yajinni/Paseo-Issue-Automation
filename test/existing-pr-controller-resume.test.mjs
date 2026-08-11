import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  existingPrControllerResumeEligibility,
  resumeExistingPrController,
} from '../src/existing-pr-controller-resume.mjs';

const head = '1a3097b84539f48eb0b793cb1183916ea6613b94';
const branch = 'ai/issue-239-canary-verify-managed-autonomous-coding-lifecycl';

function failedCanaryState(overrides = {}) {
  return {
    issueNumber: 239,
    issueTitle: 'Canary: verify managed autonomous coding lifecycle',
    status: 'paseo:failed',
    phase: 'queued',
    restartPreviousPhase: 'failed',
    restartPreviousReason: 'Managed quick review output was malformed.',
    restartPending: true,
    branch,
    attempt: 1,
    workspaceId: 'wks_49e6c624fad052b4',
    worktreePath: '/worktrees/canary',
    workspaceTitle: branch,
    workspaceName: branch,
    coderAgentId: '88d4c5c1-8dba-4814-aa8d-4c6f9567546b',
    agentId: '88d4c5c1-8dba-4814-aa8d-4c6f9567546b',
    agentTitle: 'Issue #239 Coder',
    prNumber: 246,
    prUrl: 'https://github.com/yajinni/Paseo-Issue-Automation/pull/246',
    failedAttemptRecoveryCount: 1,
    activity: [],
    events: [],
    ...overrides,
  };
}

function reusablePr() {
  return {
    number: 246,
    url: 'https://github.com/yajinni/Paseo-Issue-Automation/pull/246',
    baseRefName: 'main',
    headRefOid: head,
    isDraft: true,
  };
}

function verifiedAgents() {
  return {
    verified: true,
    reason: null,
    agents: [{
      id: '88d4c5c1-8dba-4814-aa8d-4c6f9567546b',
      name: 'Issue #239 Coder',
      cwd: '/worktrees/canary',
    }],
  };
}

test('controller-only resume preserves an exhausted failed attempt with an exact existing PR', () => {
  const calls = [];
  const writes = [];
  const spawns = [];
  let current = failedCanaryState();

  const result = resumeExistingPrController('/repo', 239, {
    readRun: () => current,
    writeRun: (_root, _number, next) => {
      current = next;
      writes.push(next);
      return next;
    },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => {},
    inspectAgents: () => verifiedAgents(),
    prReader: () => reusablePr(),
    remoteHeadReader: () => head,
    runner(command, args) {
      calls.push([command, args]);
      if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: head, stderr: '' };
      if (command === 'git' && args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    executable: '/node',
    workerPath: '/recovery-controller-worker.mjs',
    spawnFn(command, args, options) {
      spawns.push({ command, args, options });
      return { pid: 106016, unref() {} };
    },
  });

  assert.equal(result.resumed, true);
  assert.equal(result.recovered, true);
  assert.equal(result.attempt, 1);
  assert.equal(result.workspaceId, 'wks_49e6c624fad052b4');
  assert.equal(result.prNumber, 246);
  assert.equal(result.head, head);
  assert.equal(current.phase, 'resuming-existing-pr-controller');
  assert.equal(current.status, 'agent-running');
  assert.equal(current.failedAttemptRecoveryCount, 1);
  assert.equal(current.controllerPid, 106016);
  assert.equal(writes.length, 2);
  assert.ok(!calls.some(([command, args]) => command === 'paseo' && args[0] === 'send'));
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args, ['/recovery-controller-worker.mjs', path.resolve('/repo'), '239']);
});

test('existing PR controller resume does not depend on remaining failed-attempt recovery budget', () => {
  const decision = existingPrControllerResumeEligibility(failedCanaryState({ failedAttemptRecoveryCount: 99 }), {
    branchAction: 'keep',
  });
  assert.equal(decision.eligible, true);
});

test('controller-only resume can recover an active attempt whose controller process is gone', () => {
  const state = failedCanaryState({
    status: 'agent-running',
    phase: 'updating-from-base',
    controllerPid: 106532,
    completedAt: null,
  });
  const decision = existingPrControllerResumeEligibility(state, {
    branchAction: 'keep',
    controllerAlive: () => false,
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.orphanedController, true);
});

test('controller-only resume fails closed when pushed branch head differs from local HEAD', () => {
  const state = failedCanaryState();
  let writes = 0;
  let spawns = 0;
  const result = resumeExistingPrController('/repo', 239, {
    readRun: () => state,
    writeRun: () => { writes += 1; throw new Error('mismatch must not mutate state'); },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => {},
    inspectAgents: () => verifiedAgents(),
    prReader: () => reusablePr(),
    remoteHeadReader: () => 'deadbee84539f48eb0b793cb1183916ea6613b94',
    runner(command, args) {
      if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: head, stderr: '' };
      if (command === 'git' && args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    spawnFn: () => { spawns += 1; return { pid: 1 }; },
  });

  assert.equal(result.resumed, false);
  assert.match(result.reason, /does not match local HEAD/i);
  assert.equal(writes, 0);
  assert.equal(spawns, 0);
});

test('controller-only resume fails closed for a dirty existing PR worktree', () => {
  const state = failedCanaryState();
  let writes = 0;
  const result = resumeExistingPrController('/repo', 239, {
    readRun: () => state,
    writeRun: () => { writes += 1; throw new Error('dirty worktree must not mutate state'); },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => {},
    inspectAgents: () => verifiedAgents(),
    prReader: () => reusablePr(),
    remoteHeadReader: () => head,
    runner(command, args) {
      if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: head, stderr: '' };
      if (command === 'git' && args[0] === 'status') return { ok: true, stdout: ' M docs/autonomous-release-canary.md', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.resumed, false);
  assert.match(result.reason, /not clean/i);
  assert.equal(writes, 0);
});

test('controller-only resume refuses an unexpected PR or base branch', () => {
  const state = failedCanaryState();
  const common = {
    readRun: () => state,
    writeRun: () => { throw new Error('invalid PR must not mutate state'); },
    configLoader: () => ({ baseBranch: 'main' }),
    verifyWorkspace: () => {},
    inspectAgents: () => verifiedAgents(),
    remoteHeadReader: () => head,
    runner: () => ({ ok: true, stdout: '', stderr: '' }),
  };

  const wrongNumber = resumeExistingPrController('/repo', 239, {
    ...common,
    prReader: () => ({ ...reusablePr(), number: 999 }),
  });
  assert.equal(wrongNumber.resumed, false);
  assert.match(wrongNumber.reason, /does not match recorded PR/i);

  const wrongBase = resumeExistingPrController('/repo', 239, {
    ...common,
    prReader: () => ({ ...reusablePr(), baseRefName: 'release' }),
  });
  assert.equal(wrongBase.resumed, false);
  assert.match(wrongBase.reason, /instead of main/i);
});
