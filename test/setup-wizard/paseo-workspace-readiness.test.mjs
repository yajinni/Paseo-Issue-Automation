import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensurePermanentPaseoWorkspace,
  findMatchingPaseoWorkspace,
  probePaseoWorktreeReadiness,
} from '../../src/setup-wizard/paseo-workspace-readiness.mjs';

function temporaryCheckout(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-workspace-ready-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function commandResult(value) {
  return { ok: true, exitCode: 0, stdout: JSON.stringify(value), stderr: '' };
}

test('exactly one matching permanent workspace is reused without creating another', (t) => {
  const checkout = temporaryCheckout(t);
  const calls = [];
  const context = {
    command(args) {
      calls.push(args);
      if (args[1] === 'ls') return commandResult({ workspaces: [{ id: 'ws-1', path: checkout, isolation: 'local' }] });
      throw new Error('workspace create must not run');
    },
  };
  const result = ensurePermanentPaseoWorkspace(context, {
    checkout,
    repositoryRemote: 'https://github.com/acme/project.git',
    baseBranch: 'main',
  });
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.created, false);
  assert.equal(result.workspace.id, 'ws-1');
  assert.equal(calls.filter((args) => args[1] === 'create').length, 0);
});

test('multiple matching workspaces block instead of guessing', (t) => {
  const checkout = temporaryCheckout(t);
  const context = {
    command: () => commandResult({ workspaces: [
      { id: 'ws-1', path: checkout, isolation: 'local' },
      { id: 'ws-2', path: checkout, isolation: 'local' },
    ] }),
  };
  const result = findMatchingPaseoWorkspace(context, { checkout, baseBranch: 'main' });
  assert.equal(result.ok, false);
  assert.equal(result.blocker.code, 'paseo-workspace-ambiguous');
  assert.equal(result.matches.length, 2);
});

test('remote-only partial identity match with a different checkout is blocked', (t) => {
  const checkout = temporaryCheckout(t);
  const other = path.join(path.dirname(checkout), 'other-checkout');
  const context = {
    command: () => commandResult({ workspaces: [{
      id: 'ws-remote',
      path: other,
      remote: 'git@github.com:acme/project.git',
      isolation: 'local',
    }] }),
  };
  const result = findMatchingPaseoWorkspace(context, {
    checkout,
    repositoryRemote: 'https://github.com/acme/project.git',
    baseBranch: 'main',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker.code, 'paseo-workspace-identity-mismatch');
});

test('missing permanent workspace is created locally then verified by re-listing', (t) => {
  const checkout = temporaryCheckout(t);
  let created = false;
  const calls = [];
  const context = {
    command(args) {
      calls.push(args);
      if (args[1] === 'ls') {
        return commandResult({ workspaces: created ? [{ id: 'ws-created', path: checkout, isolation: 'local' }] : [] });
      }
      if (args[1] === 'create' && args.includes('local')) {
        created = true;
        return commandResult({ id: 'ws-created', path: checkout, isolation: 'local' });
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
  };
  const result = ensurePermanentPaseoWorkspace(context, { checkout, baseBranch: 'main' });
  assert.equal(result.ok, true);
  assert.equal(result.reused, false);
  assert.equal(result.created, true);
  assert.equal(result.workspace.id, 'ws-created');
  const create = calls.find((args) => args[1] === 'create');
  assert.deepEqual(create.slice(0, 5), ['workspace', 'create', '--isolation', 'local', '--path']);
  assert.ok(create.includes(checkout));
});

test('readiness probe creates no agent and verifies temporary worktree, archive, branch, and directory cleanup', (t) => {
  const checkout = temporaryCheckout(t);
  const worktree = path.join(path.dirname(checkout), `probe-worktree-${Date.now()}`);
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  let branch = null;
  let workspaceActive = false;
  const paseoCalls = [];
  const context = {
    command(args) {
      paseoCalls.push(args);
      assert.equal(args[0], 'workspace');
      assert.equal(args.includes('run'), false);
      if (args[1] === 'create') {
        branch = args[args.indexOf('--new-branch') + 1];
        workspaceActive = true;
        mkdirSync(worktree, { recursive: true });
        return commandResult({ id: 'probe-ws', path: worktree, branch, isolation: 'worktree' });
      }
      if (args[1] === 'archive') {
        workspaceActive = false;
        rmSync(worktree, { recursive: true, force: true });
        branch = null;
        return commandResult({ archived: true });
      }
      throw new Error(`unexpected paseo command: ${args.join(' ')}`);
    },
  };
  const runner = (_command, args) => {
    if (args[0] === 'worktree' && args[1] === 'list') {
      const paths = [checkout, ...(workspaceActive ? [worktree] : [])];
      return { ok: true, stdout: paths.map((entry) => `worktree ${entry}`).join('\n'), stderr: '' };
    }
    if (args[0] === 'show-ref') return { ok: branch ? true : false, stdout: '', stderr: '' };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const result = probePaseoWorktreeReadiness(context, { checkout, baseBranch: 'main', runner });
  assert.equal(result.ok, true);
  assert.equal(result.paidModelRequestSent, false);
  assert.deepEqual(result.cleanup, { pathRemoved: true, branchRemoved: true, directoryRemoved: true });
  assert.deepEqual(paseoCalls.map((args) => args.slice(0, 2)), [
    ['workspace', 'create'],
    ['workspace', 'archive'],
  ]);
  assert.equal(paseoCalls.some((args) => args[0] === 'run'), false);
});

test('failed readiness cleanup remains a visible blocker and is not force-deleted', (t) => {
  const checkout = temporaryCheckout(t);
  const worktree = path.join(path.dirname(checkout), `probe-leftover-${Date.now()}`);
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  let workspaceActive = false;
  let branchExists = false;
  const context = {
    command(args) {
      if (args[1] === 'create') {
        workspaceActive = true;
        branchExists = true;
        mkdirSync(worktree, { recursive: true });
        return commandResult({ id: 'probe-ws', path: worktree, isolation: 'worktree' });
      }
      if (args[1] === 'archive') return { ok: false, exitCode: 1, stdout: '', stderr: 'teardown failed' };
      throw new Error('unexpected command');
    },
  };
  const runner = (_command, args) => {
    if (args[0] === 'worktree') {
      return { ok: true, stdout: [checkout, ...(workspaceActive ? [worktree] : [])].map((entry) => `worktree ${entry}`).join('\n'), stderr: '' };
    }
    if (args[0] === 'show-ref') return { ok: branchExists, stdout: '', stderr: '' };
    throw new Error(`unexpected git mutation: ${args.join(' ')}`);
  };
  const result = probePaseoWorktreeReadiness(context, { checkout, baseBranch: 'main', runner });
  assert.equal(result.ok, false);
  assert.equal(result.blocker.code, 'paseo-readiness-cleanup-failed');
  assert.equal(existsSync(worktree), true);
  assert.equal(branchExists, true);
});
