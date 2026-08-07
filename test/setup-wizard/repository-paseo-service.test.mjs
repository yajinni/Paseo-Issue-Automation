import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensurePaseoProjectWorkspace,
  PERMANENT_PASEO_WORKSPACE_NAME,
} from '../../src/setup-wizard/repository-paseo-service.mjs';

function temporaryRoot(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-project-setup-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function gitRepository(root, name = 'app') {
  const checkout = path.join(root, name);
  mkdirSync(checkout, { recursive: true });
  execFileSync('git', ['init'], { cwd: checkout, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/octo/app.git'], { cwd: checkout });
  return checkout;
}

function runner(command, args, options = {}) {
  if (command !== 'git') throw new Error(`Unexpected command: ${command}`);
  try {
    const stdout = execFileSync(command, args, { cwd: options.cwd, encoding: 'utf8' });
    return { ok: true, stdout: String(stdout).trim(), stderr: '', exitCode: 0 };
  } catch (error) {
    return { ok: false, stdout: String(error.stdout || '').trim(), stderr: String(error.stderr || '').trim(), exitCode: error.status ?? 1 };
  }
}

function workspaceRow(checkout, overrides = {}) {
  return {
    workspaceId: 'workspace-1',
    project: 'app',
    name: PERMANENT_PASEO_WORKSPACE_NAME,
    isolation: 'local',
    cwd: checkout,
    ...overrides,
  };
}

test('reuses an existing Paseo project permanent workspace for the selected repository', (t) => {
  const rootDir = temporaryRoot(t);
  const checkout = gitRepository(rootDir);
  const commands = [];
  const context = {
    command(args) {
      commands.push(args);
      assert.deepEqual(args, ['workspace', 'ls', '--json']);
      return { ok: true, stdout: JSON.stringify([workspaceRow(checkout)]), stderr: '' };
    },
  };

  const result = ensurePaseoProjectWorkspace(context, 'octo/app', { rootDir, runner });
  assert.equal(result.ok, true);
  assert.equal(result.project.name, 'app');
  assert.equal(result.project.checkoutPath, checkout);
  assert.equal(result.workspace.name, PERMANENT_PASEO_WORKSPACE_NAME);
  assert.equal(result.createdProject, false);
  assert.equal(result.createdWorkspace, false);
  assert.equal(commands.length, 2);
});

test('uses Paseo clone to create a missing project, then creates the permanent workspace automatically', (t) => {
  const rootDir = temporaryRoot(t);
  const managedRoot = path.join(rootDir, 'managed-repositories');
  const checkout = gitRepository(managedRoot, 'octo--app');
  let listCount = 0;
  const commands = [];
  const context = {
    command(args) {
      commands.push(args);
      if (args[0] === 'workspace' && args[1] === 'ls') {
        listCount += 1;
        const rows = listCount === 1 ? [] : [workspaceRow(checkout, { workspaceId: 'permanent-1' })];
        return { ok: true, stdout: JSON.stringify(rows), stderr: '' };
      }
      if (args[0] === 'clone') {
        return {
          ok: true,
          stdout: JSON.stringify({ repo: 'octo/app', checkoutPath: checkout, projectId: 'project-1', projectName: 'app' }),
          stderr: '',
        };
      }
      if (args[0] === 'workspace' && args[1] === 'create') {
        return { ok: true, stdout: JSON.stringify({ workspaceId: 'permanent-1' }), stderr: '' };
      }
      throw new Error(`Unexpected Paseo command: ${args.join(' ')}`);
    },
  };

  const result = ensurePaseoProjectWorkspace(context, 'octo/app', { rootDir, managedRoot, runner });
  assert.equal(result.ok, true);
  assert.equal(result.createdProject, true);
  assert.equal(result.createdWorkspace, true);
  assert.deepEqual(commands.find((args) => args[0] === 'clone'), [
    'clone', 'octo/app', '--dir', managedRoot, '--protocol', 'https', '--json',
  ]);
  const create = commands.find((args) => args[0] === 'workspace' && args[1] === 'create');
  assert.deepEqual(create, [
    'workspace', 'create', '--isolation', 'local', '--path', checkout,
    '--title', PERMANENT_PASEO_WORKSPACE_NAME, '--json',
  ]);
});

test('creates only the permanent workspace when Paseo already has this repository project', (t) => {
  const rootDir = temporaryRoot(t);
  const checkout = gitRepository(rootDir);
  let listCount = 0;
  const commands = [];
  const context = {
    command(args) {
      commands.push(args);
      if (args[0] === 'workspace' && args[1] === 'ls') {
        listCount += 1;
        const rows = listCount === 1
          ? [workspaceRow(checkout, { workspaceId: 'other-1', name: 'Another workspace' })]
          : [
            workspaceRow(checkout, { workspaceId: 'other-1', name: 'Another workspace' }),
            workspaceRow(checkout, { workspaceId: 'permanent-1' }),
          ];
        return { ok: true, stdout: JSON.stringify(rows), stderr: '' };
      }
      if (args[0] === 'workspace' && args[1] === 'create') {
        return { ok: true, stdout: JSON.stringify({ workspaceId: 'permanent-1' }), stderr: '' };
      }
      throw new Error(`Unexpected Paseo command: ${args.join(' ')}`);
    },
  };

  const result = ensurePaseoProjectWorkspace(context, 'octo/app', { rootDir, runner });
  assert.equal(result.ok, true);
  assert.equal(result.createdProject, false);
  assert.equal(result.createdWorkspace, true);
  assert.equal(commands.some((args) => args[0] === 'clone'), false);
});
