import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import {
  extractRepositoryOption,
  resolveRepositoryInvocation,
} from '../src/repository-context.mjs';

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

test('repository option is extracted without leaking into legacy command parsing', () => {
  assert.deepEqual(extractRepositoryOption(['status', '--repo', 'example', '--other']), {
    selector: 'example',
    args: ['status', '--other'],
  });
  assert.deepEqual(extractRepositoryOption(['--repo=example', 'status']), {
    selector: 'example',
    args: ['status'],
  });
  assert.throws(() => extractRepositoryOption(['status', '--repo']), /requires/);
  assert.throws(() => extractRepositoryOption(['--repo=one', '--repo', 'two']), /only once/);
});

test('registered repository context can be selected from any directory', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-context-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const registered = addRepository(repositoryRoot, {
    rootDir,
    runner: fakeGit(repositoryRoot),
  });
  const invocation = resolveRepositoryInvocation(['status', '--repo', registered.id], {
    cwd: rootDir,
    rootDir,
    runner: fakeGit(repositoryRoot),
  });
  assert.deepEqual(invocation.args, ['status']);
  assert.equal(invocation.context.path, repositoryRoot);
  assert.equal(invocation.context.source, 'registry');
});

test('current-directory fallback remains compatible without registration', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-context-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const invocation = resolveRepositoryInvocation(['status'], {
    cwd: path.join(repositoryRoot, 'nested'),
    rootDir,
    runner: fakeGit(repositoryRoot),
  });
  assert.equal(invocation.context.path, repositoryRoot);
  assert.equal(invocation.context.source, 'cwd');
  assert.equal(invocation.context.registered, false);
});

test('unknown repository selectors fail before legacy commands run', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-context-'));
  assert.throws(() => resolveRepositoryInvocation(['status', '--repo', 'missing'], {
    rootDir,
    runner: () => ({ ok: false, stdout: '', stderr: '' }),
  }), /repo add PATH/);
});

test('entrypoint changes directory only for selected registered repositories', async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-context-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const registered = addRepository(repositoryRoot, {
    rootDir,
    runner: fakeGit(repositoryRoot),
  });
  const calls = [];
  await dispatchCli(['status', '--repo', registered.id], {
    cwd: rootDir,
    rootDir,
    runner: fakeGit(repositoryRoot),
    changeDirectory: (next) => calls.push(['chdir', next]),
    mainCommand: async (nextArgs) => calls.push(['main', nextArgs]),
  });
  assert.deepEqual(calls, [
    ['chdir', repositoryRoot],
    ['main', ['status']],
  ]);
});
