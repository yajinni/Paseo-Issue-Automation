import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerConfigurationApiRequest } from '../src/manager-configuration-service.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function fixture(t, remote = 'git@github.com:yajinni/Example.git') {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-branches-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  return { rootDir, repository };
}

function route(repository) {
  return `/api/repositories/${encodeURIComponent(repository.id)}/configuration/branches`;
}

test('manager configuration returns GitHub branches for the selected registered repository', async (t) => {
  const { rootDir, repository } = fixture(t);
  let request = null;
  const response = await managerConfigurationApiRequest({
    method: 'GET',
    pathname: route(repository),
  }, {
    rootDir,
    branchLoader(nameWithOwner, options) {
      request = { nameWithOwner, host: options.host };
      return {
        ok: true,
        repository: nameWithOwner,
        recommended: 'main',
        branches: [
          { name: 'feature/setup', oid: '111', recommended: false, selectable: true },
          { name: 'main', oid: '222', recommended: true, selectable: true },
        ],
      };
    },
  });

  assert.equal(response.handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(request, { nameWithOwner: 'yajinni/Example', host: 'github.com' });
  assert.equal(response.body.repository, 'yajinni/Example');
  assert.equal(response.body.recommendedBranch, 'main');
  assert.deepEqual(response.body.branches.map((branch) => branch.name), ['feature/setup', 'main']);
  assert.equal(response.body.blocker, null);
});

test('manager configuration derives a GitHub Enterprise host from the repository remote', async (t) => {
  const { rootDir, repository } = fixture(t, 'git@github.example.com:yajinni/Example.git');
  let host = null;
  await managerConfigurationApiRequest({ method: 'GET', pathname: route(repository) }, {
    rootDir,
    branchLoader(_repository, options) {
      host = options.host;
      return { ok: true, branches: [], recommended: null };
    },
  });
  assert.equal(host, 'github.example.com');
});
