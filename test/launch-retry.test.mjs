import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentRunArgs,
  cleanupWorkspaceIfEmpty,
  expectedWorkspaceAgent,
  inspectWorkspaceAgents,
  nextReconciliationAttempt,
  PASEO_WORKTREE_SLUG_MAX_LENGTH,
  refreshConfiguredBase,
  verifyWorkspaceIdentity,
  worktreeSlugForBranch,
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
  assert.ok(create.includes('--worktree-slug'));
  assert.equal(create[create.indexOf('--base') + 1], 'main');
  assert.ok(!create.includes('run'));
  assert.equal(start[0], 'run');
  assert.deepEqual(start.slice(start.indexOf('--workspace'), start.indexOf('--workspace') + 2), ['--workspace', 'wks_one']);
  assert.ok(!start.includes('--new-workspace'));
  assert.ok(!start.includes('--new-branch'));
});

test('workspace creation passes an exact verified base SHA unchanged', () => {
  const baseSha = 'a'.repeat(40);
  const create = workspaceCreateArgs({
    root: '/repo',
    title: 'ai/issue-274-test-attempt-2',
    branch: 'ai/issue-274-test-attempt-2',
    baseBranch: 'main',
    baseSha,
  });

  assert.equal(create[create.indexOf('--base') + 1], baseSha);
});

test('workspace creation preserves an explicitly qualified base ref', () => {
  const baseRef = 'refs/remotes/origin/openspec';
  const create = workspaceCreateArgs({
    root: '/repo',
    title: 'ai/issue-274-test-attempt-2',
    branch: 'ai/issue-274-test-attempt-2',
    baseBranch: baseRef,
  });

  assert.equal(create[create.indexOf('--base') + 1], baseRef);
});

test('long retry branches receive distinct short Paseo worktree slugs', () => {
  const first = 'ai/issue-274-reconcile-accepted-openspec-and-rewrite-status';
  const second = `${first}-attempt-2`;
  const firstSlug = worktreeSlugForBranch(first);
  const secondSlug = worktreeSlugForBranch(second);

  assert.notEqual(firstSlug, secondSlug);
  assert.match(firstSlug, /^pia-i274-a1-[a-f0-9]{12}$/);
  assert.match(secondSlug, /^pia-i274-a2-[a-f0-9]{12}$/);
  assert.ok(firstSlug.length <= PASEO_WORKTREE_SLUG_MAX_LENGTH);
  assert.ok(secondSlug.length <= PASEO_WORKTREE_SLUG_MAX_LENGTH);

  const args = workspaceCreateArgs({ root: '/repo', title: second, branch: second, baseBranch: 'main' });
  const slugIndex = args.indexOf('--worktree-slug');
  assert.equal(args[slugIndex + 1], secondSlug);
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

test('configured base refresh fetches and verifies the exact remote SHA', () => {
  const calls = [];
  const result = refreshConfiguredBase('/repo', 'openspec', {
    now: () => '2026-08-13T12:00:00.000Z',
    runner(command, args) {
      calls.push([command, args]);
      if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { ok: true, stdout: 'A'.repeat(40), stderr: '' };
      return { ok: true, stdout: `${'A'.repeat(40)}\trefs/heads/openspec\n`, stderr: '' };
    },
  });
  assert.deepEqual(result, {
    baseBranch: 'openspec',
    baseRef: 'refs/remotes/origin/openspec',
    baseSha: 'a'.repeat(40),
    verifiedAt: '2026-08-13T12:00:00.000Z',
  });
  assert.deepEqual(calls[0], ['git', ['fetch', '--prune', 'origin', '+refs/heads/openspec:refs/remotes/origin/openspec']]);
  assert.deepEqual(calls[1], ['git', ['rev-parse', 'refs/remotes/origin/openspec^{commit}']]);
  assert.deepEqual(calls[2], ['git', ['ls-remote', 'origin', 'refs/heads/openspec']]);
});

test('configured base refresh fails closed before workspace creation evidence can proceed', () => {
  assert.throws(() => refreshConfiguredBase('/repo', 'main', {
    runner: (_command, args) => args[0] === 'fetch'
      ? { ok: false, stdout: '', stderr: 'remote unavailable' }
      : { ok: true, stdout: '', stderr: '' },
  }), /Could not fetch origin\/main.*remote unavailable/);
});

test('workspace identity verifies the initial HEAD against the recorded base SHA', () => {
  const calls = [];
  assert.doesNotThrow(() => verifyWorkspaceIdentity('/repo', {
    workspaceId: 'wks-main', worktreePath: '/worktrees/main', workspaceName: 'branch',
  }, { title: 'branch', branch: 'ai/issue-1', baseSha: 'b'.repeat(40) }, {
    runner: (_command, args) => {
      calls.push(args);
      return { ok: true, stdout: args.includes('branch') ? 'ai/issue-1' : 'b'.repeat(40), stderr: '' };
    },
  }));
  assert.equal(calls.length, 2);
});


test('workspace reconciliation stops after three failed checks', () => {
  assert.deepEqual(nextReconciliationAttempt(0), { attempt: 1, maximum: 3, exhausted: false });
  assert.deepEqual(nextReconciliationAttempt(1), { attempt: 2, maximum: 3, exhausted: false });
  assert.deepEqual(nextReconciliationAttempt(2), { attempt: 3, maximum: 3, exhausted: true });
});
