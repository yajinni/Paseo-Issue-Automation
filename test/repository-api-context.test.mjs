import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseRepositoryApiPath,
  repositoryRegistryRequest,
  resolveRepositoryApiContext,
} from '../src/repository-api-context.mjs';

function fakeGit(repositoryRoot, remote = 'git@github.com:yajinni/Example.git') {
  return (_command, args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { ok: true, stdout: repositoryRoot, stderr: '' };
    if (args.join(' ') === 'remote get-url origin') return { ok: true, stdout: remote, stderr: '' };
    return { ok: false, stdout: '', stderr: 'unexpected command' };
  };
}

test('repository API paths separate registry and repository-scoped routes', () => {
  assert.deepEqual(parseRepositoryApiPath('/api/repositories'), {
    matched: true,
    selector: null,
    repositoryPath: null,
  });
  assert.deepEqual(parseRepositoryApiPath('/api/repositories/yajinni%2FExample/status'), {
    matched: true,
    selector: 'yajinni/Example',
    repositoryPath: '/status',
  });
  assert.equal(parseRepositoryApiPath('/api/status').matched, false);
});

test('registry requests add, list, read, and remove without touching repository state', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const options = { rootDir, runner: fakeGit(repositoryRoot) };
  const added = repositoryRegistryRequest({
    method: 'POST',
    pathname: '/api/repositories',
    body: { path: repositoryRoot },
  }, options);
  assert.equal(added.status, 201);
  const id = added.body.repository.id;
  assert.equal(repositoryRegistryRequest({ method: 'GET', pathname: '/api/repositories' }, options).body.repositories.length, 1);
  assert.equal(repositoryRegistryRequest({ method: 'GET', pathname: `/api/repositories/${id}` }, options).body.repository.id, id);
  assert.equal(repositoryRegistryRequest({ method: 'DELETE', pathname: `/api/repositories/${id}` }, options).body.repository.id, id);
  assert.equal(repositoryRegistryRequest({ method: 'GET', pathname: '/api/repositories' }, options).body.repositories.length, 0);
});

test('repository-scoped routes resolve to one validated legacy API root', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  const options = { rootDir, runner: fakeGit(repositoryRoot) };
  const added = repositoryRegistryRequest({
    method: 'POST',
    pathname: '/api/repositories',
    body: { path: repositoryRoot },
  }, options).body.repository;
  const context = resolveRepositoryApiContext(`/api/repositories/${added.id}/status`, options);
  assert.equal(context.root, repositoryRoot);
  assert.equal(context.pathname, '/api/status');
  assert.equal(context.repository.id, added.id);
});

test('unknown repository-scoped routes fail before another root can be used', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-repository-api-'));
  assert.throws(() => resolveRepositoryApiContext('/api/repositories/missing/status', {
    rootDir,
    runner: () => ({ ok: false, stdout: '', stderr: '' }),
  }), /not registered/);
});
