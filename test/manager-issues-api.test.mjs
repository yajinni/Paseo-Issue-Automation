import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { addRepository } from '../src/repository-registry.mjs';

test('issue plan is loaded from its own repository endpoint', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-issues-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  const calls = [];
  const response = managerApiRequest({
    method: 'GET',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/issues-plan`,
  }, {
    rootDir,
    repositoryConfigLoader: (root) => { calls.push(['config', root]); return { issueSelection: { mode: 'all-open' } }; },
    issuePlanner: (root, config) => {
      calls.push(['plan', root, config.issueSelection.mode]);
      return { mode: 'all-open', total: 2, eligible: 1, blocked: 1, skipped: 0, active: 0, nextIssueNumber: 4, items: [] };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.issuePlan.available, true);
  assert.equal(response.body.issuePlan.nextIssueNumber, 4);
  assert.deepEqual(calls, [
    ['config', repositoryRoot],
    ['plan', repositoryRoot, 'all-open'],
  ]);
});

test('issue plan failures stay local to the Issues view', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-issues-api-error-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  const response = managerApiRequest({
    method: 'GET',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/issues-plan`,
  }, {
    rootDir,
    repositoryConfigLoader: () => ({}),
    issuePlanner: () => { throw new Error('GitHub issue query unavailable'); },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.issuePlan.available, false);
  assert.match(response.body.issuePlan.error, /GitHub issue query unavailable/);
});
