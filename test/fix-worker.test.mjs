import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completeFixJob } from '../src/fix-worker.mjs';
import { createFixJobInStore, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { findManaged, loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-fix-worker-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  savePrAutomationConfig(root, { enabled: true, browserReview: { enabled: true, reviewDebounceMs: 0 } });
  return root;
}

test('fixes update the existing PR and requeue only the new head SHA', (t) => {
  const root = repo(t);
  const registered = registerManagedPullRequest(root, {
    repository: 'owner/repo', issueNumber: 101, issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45, pullRequestUrl: 'https://github.com/owner/repo/pull/45', branchName: 'ai/issue-101',
    workspaceId: 'workspace-1', currentHeadSha: 'abcdef123',
  }, { now: 1000 });
  let fixJobId;
  mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, registered.managed.id);
    const reviewJob = store.reviewJobs[0];
    reviewJob.state = 'awaiting_result';
    const fix = createFixJobInStore(store, managed, reviewJob, 'Update src/a.mjs and tests.', { now: 2000 });
    fix.state = 'fixing';
    fix.coderAgentId = 'coder-1';
    fixJobId = fix.id;
  });
  const result = completeFixJob(root, fixJobId, {
    waitForAgent: false,
    snapshot: { state: 'OPEN', headRefOid: 'abcdef456' },
    labelWriter: () => ({ changed: true }),
  });
  const store = loadPrReviewStore(root);
  assert.equal(result.newHeadSha, 'abcdef456');
  assert.equal(store.managedPullRequests.length, 1);
  assert.equal(store.managedPullRequests[0].pullRequestNumber, 45);
  assert.equal(store.managedPullRequests[0].reviewRound, 2);
  assert.equal(store.fixJobs[0].state, 'completed');
  assert.equal(store.reviewJobs.at(-1).headSha, 'abcdef456');
  assert.equal(store.reviewJobs.at(-1).state, 'queued');
});
