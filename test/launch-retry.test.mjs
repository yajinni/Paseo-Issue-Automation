import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentRunArgs,
  cleanupWorkspaceIfEmpty,
  expectedWorkspaceAgent,
  inspectWorkspaceAgents,
  verifyWorkspaceIdentity,
  workspaceCreateArgs,
} from '../src/launch-retry.mjs';

test('workspace creation and agent start are separate commands', () => {
  const create = workspaceCreateArgs({
    root: '/repo',
    title: 'ai/issue-274-test-attempt-2',
    branch: 'ai/issue-274-test-attempt-2',
    baseBranch: 'main',
  });
  const start = agentRunArgs({
    provider: 'opencode/openai/model',
    title: 'Issue #274 Coder (attempt 2)',
    workspaceId: 'wks_one',
    prompt: 'do the work',
  });
  assert.equal(create[0], 'workspace');
  assert.ok(create.includes('--new-branch'));
  assert.ok(!create.includes('run'));
  assert.equal(start[0], 'run');
  assert.deepEqual(start.slice(start.indexOf('--workspace'), start.indexOf('--workspace') + 2), ['--workspace', 'wks_one']);
  assert.ok(!start.includes('--new-workspace'));
  assert.ok(!start.includes('--new-branch'));
});

test('workspace agent inspection matches only the recorded worktree', () => {
  const runner = () => ({
    ok: true,
    stdout: JSON.stringify({ data: [
      { id: 'agent-one', name: 'Issue #274 Coder (attempt 2)', cwd: '/worktrees/issue-274' },
      { id: 'agent-two', name: 'Other', cwd: '/worktrees/other' },
    ] }),
    stderr: '',
  });
  const inspection = inspectWorkspaceAgents('/repo', '/worktrees/issue-274', { runner });
  assert.equal(inspection.verified, true);
  assert.deepEqual(inspection.agents.map((agent) => agent.id), ['agent-one']);
  assert.equal(expectedWorkspaceAgent(inspection, 'Issue #274 Coder (attempt 2)').status, 'found');
});

test('cleanup archives only a verified empty workspace', () => {
  const calls = [];
  const emptyRunner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'ls') return { ok: true, stdout: JSON.stringify({ data: [] }), stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
  const archived = cleanupWorkspaceIfEmpty('/repo', {
    workspaceId: 'wks_empty',
    worktreePath: '/worktrees/empty',
  }, { runner: emptyRunner });
  assert.equal(archived.status, 'archived-empty');
  assert.ok(calls.some(([, args]) => args.join(' ') === 'workspace archive wks_empty'));

  let archivedNonempty = false;
  const nonemptyRunner = (_command, args) => {
    if (args[0] === 'ls') {
      return { ok: true, stdout: JSON.stringify({ data: [{ id: 'agent', cwd: '/worktrees/used', name: 'agent' }] }), stderr: '' };
    }
    archivedNonempty = true;
    return { ok: true, stdout: '', stderr: '' };
  };
  const preserved = cleanupWorkspaceIfEmpty('/repo', {
    workspaceId: 'wks_used',
    worktreePath: '/worktrees/used',
  }, { runner: nonemptyRunner });
  assert.equal(preserved.status, 'skipped-nonempty');
  assert.equal(archivedNonempty, false);

  let archivedUnknown = false;
  const failedInventory = (_command, args) => {
    if (args[0] === 'ls') return { ok: false, stdout: '', stderr: 'daemon unavailable' };
    archivedUnknown = true;
    return { ok: true, stdout: '', stderr: '' };
  };
  const unknown = cleanupWorkspaceIfEmpty('/repo', {
    workspaceId: 'wks_unknown',
    worktreePath: '/worktrees/unknown',
  }, { runner: failedInventory });
  assert.equal(unknown.status, 'skipped-unverified');
  assert.equal(archivedUnknown, false);
});

test('workspace identity rejects an attempt or branch mismatch', () => {
  assert.throws(() => verifyWorkspaceIdentity('/repo', {
    workspaceId: 'wks_wrong',
    worktreePath: '/worktrees/wrong',
    workspaceName: 'ai/issue-274-attempt-2',
  }, {
    title: 'ai/issue-274-attempt-3',
    branch: 'ai/issue-274-attempt-3',
  }, {
    runner: () => ({ ok: true, stdout: 'ai/issue-274-attempt-2', stderr: '' }),
  }), /instead of/);
});
