import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerApiRequest } from '../src/manager-api.mjs';
import { addRepository } from '../src/repository-registry.mjs';

test('repository-scoped manager API delegates import with the scoped repository identity', (t) => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-pr-review-import-api-'));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', '--quiet', repositoryRoot]);
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  let received;
  const response = managerApiRequest({
    method: 'POST',
    pathname: `/api/repositories/${encodeURIComponent(repository.id)}/pr-reviews/import`,
    body: { pullRequestNumber: 309, issueNumber: 308 },
  }, {
    rootDir,
    statusReader: () => ({ ok: true }),
    prReviewImportHandler(root, input) {
      received = { root, input };
      return { imported: true };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result, { imported: true });
  assert.equal(received.root, repositoryRoot);
  assert.deepEqual(received.input, {
    id: undefined,
    repository: 'yajinni/Example',
    pullRequestNumber: 309,
    issueNumber: 308,
    headSha: undefined,
  });
});
