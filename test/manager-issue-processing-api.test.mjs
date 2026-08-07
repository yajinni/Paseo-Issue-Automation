import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { addRepository } from '../src/repository-registry.mjs';

function fixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-processing-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  return { rootDir, repositoryRoot, repository: addRepository(repositoryRoot, { rootDir }) };
}

test('manager routes unified issue-processing start through the combined handler', () => {
  const { rootDir, repositoryRoot, repository } = fixture();
  let request = null;
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/issue-processing/start`,
  }, {
    rootDir,
    workerManager: {},
    issueProcessingHandler: (value) => { request = value; return { state: 'running' }; },
    statusReader: () => ({ worker: { running: true }, automation: { claimsEnabled: true } }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.state, 'running');
  assert.equal(request.root, repositoryRoot);
  assert.equal(request.repository.id, repository.id);
  assert.equal(request.pathname, '/api/issue-processing/start');
});

test('manager routes unified issue-processing pause through the combined handler', () => {
  const { rootDir, repository } = fixture();
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/issue-processing/pause`,
  }, {
    rootDir,
    workerManager: {},
    issueProcessingHandler: () => ({ state: 'paused' }),
    statusReader: () => ({ worker: { running: false }, automation: { claimsEnabled: false } }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.state, 'paused');
  assert.equal(response.body.status.worker.running, false);
  assert.equal(response.body.status.automation.claimsEnabled, false);
});
