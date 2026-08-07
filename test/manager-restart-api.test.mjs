import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { addRepository } from '../src/repository-registry.mjs';

test('restart API returns accepted without building a full repository status snapshot', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-fast-restart-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  const calls = [];
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/restart-issue`,
    body: { issueNumber: 274, branchAction: 'keep' },
  }, {
    rootDir,
    actionHandler: (root, pathname, body) => {
      calls.push({ root, pathname, body });
      return { queued: true, issueNumber: 274, phase: 'queued', message: 'Restart queued.' };
    },
    statusReader: () => { throw new Error('restart response must not synchronously build full status'); },
  });

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [{
    root: repositoryRoot,
    pathname: '/api/restart-issue',
    body: { issueNumber: 274, branchAction: 'keep' },
  }]);
  assert.equal(response.body.result.queued, true);
  assert.equal(response.body.status, undefined);
});
