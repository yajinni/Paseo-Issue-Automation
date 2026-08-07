import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function fixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-review-worker-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  return { rootDir, repository: addRepository(repositoryRoot, { rootDir }) };
}

test('starting the PR-review worker returns an immediate lightweight acknowledgement', () => {
  const { rootDir, repository } = fixture();
  let statusReads = 0;
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/review-worker/start`,
  }, {
    rootDir,
    reviewWorkerManager: {
      start: () => ({ running: true, state: 'running', startupRecoveryPending: true }),
    },
    statusReader: () => { statusReads += 1; return {}; },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.result.running, true);
  assert.equal(response.body.result.startupRecoveryPending, true);
  assert.equal(response.body.status, undefined);
  assert.equal(statusReads, 0);
});

test('restarting the PR-review worker is also acknowledged without a full status rebuild', () => {
  const { rootDir, repository } = fixture();
  let statusReads = 0;
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/review-worker/restart`,
  }, {
    rootDir,
    reviewWorkerManager: {
      restart: () => ({ running: true, state: 'running', startupRecoveryPending: true }),
    },
    statusReader: () => { statusReads += 1; return {}; },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.result.running, true);
  assert.equal(response.body.status, undefined);
  assert.equal(statusReads, 0);
});
