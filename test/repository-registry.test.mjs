import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repositoryCommandResult } from '../src/repository-command.mjs';
import {
  addRepository,
  findRepository,
  listRepositories,
  managerHome,
  removeRepository,
  repositoryRegistryFile,
} from '../src/repository-registry.mjs';

function fakeGit(repositoryRoot, remote = 'git@github.com:yajinni/Example.git') {
  return (_command, args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return { ok: true, stdout: repositoryRoot, stderr: '' };
    }
    if (args.join(' ') === 'remote get-url origin') {
      return { ok: true, stdout: remote, stderr: '' };
    }
    return { ok: false, stdout: '', stderr: 'unexpected command' };
  };
}

test('manager home supports an explicit machine-local override', () => {
  assert.equal(
    managerHome({ env: { PASEO_ISSUE_AUTOMATION_HOME: '/manager-home' }, home: '/ignored' }),
    path.resolve('/manager-home'),
  );
});

test('repository registration is machine-global, normalized, and idempotent', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-registry-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const first = addRepository(repositoryRoot, {
    rootDir,
    runner: fakeGit(repositoryRoot),
    now: () => new Date('2026-08-06T10:00:00.000Z'),
  });
  const second = addRepository(path.join(repositoryRoot, 'nested'), {
    rootDir,
    runner: fakeGit(repositoryRoot),
    now: () => new Date('2026-08-06T11:00:00.000Z'),
  });

  assert.equal(first.id, second.id);
  assert.equal(second.repository, 'yajinni/Example');
  assert.equal(second.name, 'Example');
  assert.equal(second.addedAt, '2026-08-06T10:00:00.000Z');
  assert.equal(second.updatedAt, '2026-08-06T11:00:00.000Z');
  assert.equal(listRepositories({ rootDir }).length, 1);

  const stored = JSON.parse(readFileSync(repositoryRegistryFile({ rootDir }), 'utf8'));
  assert.equal(stored.version, 1);
  assert.equal(stored.repositories[0].path, repositoryRoot);
});

test('repositories can be found and removed by id, GitHub name, or path', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-registry-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const added = addRepository(repositoryRoot, { rootDir, runner: fakeGit(repositoryRoot) });

  assert.equal(findRepository(added.id, { rootDir }).id, added.id);
  assert.equal(findRepository('yajinni/Example', { rootDir }).id, added.id);
  assert.equal(findRepository(repositoryRoot, { rootDir }).id, added.id);
  assert.equal(removeRepository('yajinni/Example', { rootDir }).removed, true);
  assert.deepEqual(listRepositories({ rootDir }), []);
  assert.equal(removeRepository(added.id, { rootDir }).removed, false);
});

test('registration rejects paths that are not Git repositories', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-registry-'));
  assert.throws(() => addRepository('/not-a-repository', {
    rootDir,
    runner: () => ({ ok: false, stdout: '', stderr: 'not a git repository' }),
  }), /not inside an accessible Git repository/);
});

test('repository CLI commands share the machine-global registry', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-registry-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const added = repositoryCommandResult(['add', repositoryRoot], {
    rootDir,
    runner: fakeGit(repositoryRoot),
  });
  assert.equal(added.repository.repository, 'yajinni/Example');
  assert.equal(repositoryCommandResult(['list'], { rootDir }).repositories.length, 1);
  assert.equal(repositoryCommandResult(['show', added.repository.id], { rootDir }).repository.id, added.repository.id);
  assert.equal(repositoryCommandResult(['remove', added.repository.id], { rootDir }).repository.id, added.repository.id);
  assert.equal(repositoryCommandResult(['list'], { rootDir }).repositories.length, 0);
});
