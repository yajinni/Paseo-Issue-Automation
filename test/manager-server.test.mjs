import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import { managerHtml } from '../src/manager-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { loadConfig, saveConfig, saveRuntime } from '../src/state.mjs';

function createRepository(parent, name) {
  const root = path.join(parent, name);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:yajinni/${name}.git`], { cwd: root });
  return root;
}

test('manager command starts outside a repository without invoking legacy dispatch', async () => {
  const calls = [];
  const result = await dispatchCli(['manager', '--open'], {
    cwd: tmpdir(),
    rootDir: '/manager-home',
    managerCommand: async (options) => { calls.push(options); return { started: true }; },
    mainCommand: async () => { throw new Error('legacy command should not run'); },
  });
  assert.deepEqual(result, { started: true });
  assert.deepEqual(calls, [{ open: true, rootDir: '/manager-home' }]);
  await assert.rejects(
    dispatchCli(['manager', '--unknown'], { managerCommand: async () => null }),
    /Unknown manager option/,
  );
});

test('manager API returns isolated read-only repository state', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-api-'));
  const repositoryRoot = createRepository(rootDir, 'Example');
  const repository = addRepository(repositoryRoot, { rootDir });
  const current = loadConfig(repositoryRoot);
  saveConfig(repositoryRoot, {
    ...current,
    setupComplete: true,
    baseBranch: 'main',
    maxActive: 2,
    models: { ...current.models, coder: 'opencode/example-coder', reviewer: 'opencode/example-reviewer' },
  });
  saveRuntime(repositoryRoot, {
    claimsEnabled: true,
    lastDispatchAt: '2026-08-06T10:00:00.000Z',
    lastDispatchResult: { claimed: false, reason: 'No eligible issues.' },
    skippedIssueNumbers: [9],
  });

  const response = managerApiRequest({
    method: 'GET',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/status`,
  }, { rootDir });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.repository.id, repository.id);
  assert.equal(response.body.status.repository.repository, 'yajinni/Example');
  assert.equal(response.body.status.setup.complete, true);
  assert.equal(response.body.status.automation.claimsEnabled, true);
  assert.equal(response.body.status.automation.maxActive, 2);
  assert.equal(response.body.status.models.coder, 'opencode/example-coder');
  assert.equal(response.body.status.readOnly, true);

  const mutation = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/pause`,
  }, { rootDir });
  assert.equal(mutation.status, 405);
  assert.equal(mutation.body.readOnly, true);
});

test('manager UI exposes repository selection and explicit read-only status', () => {
  const html = managerHtml();
  assert.match(html, /id="repository-select"/);
  assert.match(html, /Register repository/);
  assert.match(html, /read-only for repository automation/);
  assert.match(html, /\/api\/repositories\//);
});
