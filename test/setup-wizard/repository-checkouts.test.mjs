import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { run } from '../../src/process.mjs';
import {
  cloneManagedRepository,
  discoverRepositoryCheckouts,
  ensureRepositoryCheckout,
  normalizeGitRemote,
  repositoryCheckoutCandidatePaths,
  validateCheckoutCandidate,
} from '../../src/setup-wizard/repository-checkouts.mjs';

function tempDir(t, prefix = 'paseo-checkout-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function initRepository(directory, remote = 'https://github.com/acme/project.git') {
  mkdirSync(directory, { recursive: true });
  run('git', ['init'], { cwd: directory });
  run('git', ['config', 'user.email', 'tests@example.test'], { cwd: directory });
  run('git', ['config', 'user.name', 'Setup Tests'], { cwd: directory });
  writeFileSync(path.join(directory, 'README.md'), '# test\n', 'utf8');
  run('git', ['add', 'README.md'], { cwd: directory });
  run('git', ['commit', '-m', 'initial'], { cwd: directory });
  run('git', ['branch', '-M', 'main'], { cwd: directory });
  run('git', ['remote', 'add', 'origin', remote], { cwd: directory });
  return directory;
}

const remoteProbe = () => ({ ok: true });

test('HTTPS and SSH GitHub remotes normalize to one repository identity', () => {
  const values = [
    'https://github.com/Acme/Project.git',
    'git@github.com:Acme/Project.git',
    'ssh://git@github.com/Acme/Project.git',
  ].map((value) => normalizeGitRemote(value));
  assert.equal(values.every((value) => value.identity === 'github.com/acme/project'), true);
  assert.equal(values.every((value) => value.nameWithOwner === 'Acme/Project'), true);
});

test('candidate discovery searches only registered paths, Paseo-known paths, and manager-owned direct children', (t) => {
  const root = tempDir(t);
  const registered = path.join(root, 'registered');
  const paseo = path.join(root, 'paseo-known');
  const managedRoot = path.join(root, 'managed');
  const managed = path.join(managedRoot, 'managed-one');
  const partial = path.join(managedRoot, 'managed-two.partial-123');
  const unrelated = path.join(root, 'unrelated');
  for (const directory of [registered, paseo, managed, partial, unrelated]) mkdirSync(directory, { recursive: true });
  const paths = repositoryCheckoutCandidatePaths({
    registeredRepositories: [{ path: registered }],
    paseoWorkspaces: [{ repositoryPath: paseo }],
    managedRoot,
  });
  assert.deepEqual(new Set(paths), new Set([path.resolve(registered), path.resolve(paseo), path.resolve(managed)]));
  assert.equal(paths.includes(path.resolve(unrelated)), false);
  assert.equal(paths.includes(path.resolve(partial)), false);
});

test('dirty user checkout is rejected without reset, clean, checkout, or deletion', (t) => {
  const root = tempDir(t);
  const repo = initRepository(path.join(root, 'repo'));
  writeFileSync(path.join(repo, 'local-work.txt'), 'do not touch\n', 'utf8');
  const calls = [];
  const runner = (command, args, options) => {
    calls.push([command, ...args]);
    return run(command, args, options);
  };
  const result = validateCheckoutCandidate(repo, 'acme/project', 'main', { runner, remoteProbe });
  assert.equal(result.valid, false);
  assert.equal(result.dirty, true);
  assert.ok(result.reasons.some((reason) => reason.code === 'checkout-dirty'));
  const dangerous = calls.filter((call) => ['reset', 'clean', 'checkout', 'switch'].includes(call[2]));
  assert.deepEqual(dangerous, []);
  assert.equal(existsSync(path.join(repo, 'local-work.txt')), true);
});

test('exactly one safe checkout is auto-selected and registered', (t) => {
  const root = tempDir(t);
  const repo = initRepository(path.join(root, 'safe'));
  const registrations = [];
  const result = ensureRepositoryCheckout('acme/project', 'main', {
    registeredRepositories: [{ path: repo }],
    paseoWorkspaces: [],
    managedRoot: path.join(root, 'managed'),
    remoteProbe,
    register: (checkoutPath) => { registrations.push(checkoutPath); return { path: checkoutPath }; },
  });
  assert.equal(result.status, 'selected');
  assert.equal(result.checkout.path, path.resolve(repo));
  assert.deepEqual(registrations, [path.resolve(repo)]);
});

test('multiple safe checkouts require an explicit path choice', (t) => {
  const root = tempDir(t);
  const first = initRepository(path.join(root, 'first'));
  const second = initRepository(path.join(root, 'second'), 'git@github.com:acme/project.git');
  const result = discoverRepositoryCheckouts('acme/project', 'main', {
    registeredRepositories: [{ path: first }, { path: second }],
    managedRoot: path.join(root, 'managed'),
    remoteProbe,
  });
  assert.equal(result.valid.length, 2);
  const ensured = ensureRepositoryCheckout('acme/project', 'main', {
    registeredRepositories: [{ path: first }, { path: second }],
    managedRoot: path.join(root, 'managed'),
    remoteProbe,
    register: () => { throw new Error('must not auto-register when choice is required'); },
  });
  assert.equal(ensured.status, 'choice-required');
  assert.deepEqual(new Set(ensured.choices.map((choice) => choice.path)), new Set([path.resolve(first), path.resolve(second)]));
});

test('interrupted managed clone remains marked partial and cannot be discovered as a valid checkout', (t) => {
  const root = tempDir(t);
  const managedRoot = path.join(root, 'managed');
  const clone = cloneManagedRepository('acme/project', 'main', {
    managedRoot,
    runner: (_command, args) => {
      const partial = args.at(-1);
      mkdirSync(partial, { recursive: true });
      writeFileSync(path.join(partial, 'partial-data'), 'incomplete\n', 'utf8');
      return { ok: false, exitCode: 1, stdout: '', stderr: 'interrupted' };
    },
    remoteProbe,
  });
  assert.equal(clone.ok, false);
  assert.match(path.basename(clone.partial), /\.partial-/);
  assert.equal(existsSync(clone.partial), true);
  assert.equal(existsSync(clone.marker), true);
  assert.equal(existsSync(clone.destination), false);
  const candidates = repositoryCheckoutCandidatePaths({ managedRoot });
  assert.equal(candidates.includes(path.resolve(clone.partial)), false);
});

test('successful managed clone validates before atomic rename and registration', (t) => {
  const root = tempDir(t);
  const managedRoot = path.join(root, 'managed');
  const runner = (command, args, options = {}) => {
    if (command === 'git' && args[0] === 'clone') {
      initRepository(args.at(-1));
      return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    }
    return run(command, args, options);
  };
  const registrations = [];
  const result = ensureRepositoryCheckout({ nameWithOwner: 'acme/project', url: 'https://github.com/acme/project.git' }, 'main', {
    registeredRepositories: [],
    managedRoot,
    runner,
    remoteProbe,
    register: (checkoutPath) => { registrations.push(checkoutPath); return { path: checkoutPath }; },
  });
  assert.equal(result.status, 'cloned');
  assert.equal(result.checkout.managed, true);
  assert.equal(existsSync(result.checkout.path), true);
  assert.equal(path.dirname(result.checkout.path), path.resolve(managedRoot));
  assert.deepEqual(registrations, [result.checkout.path]);
  const entries = new Set(readdirSync(managedRoot));
  assert.equal([...entries].some((name) => name.includes('.partial-') || name.endsWith('.incomplete')), false);
});
