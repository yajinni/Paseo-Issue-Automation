import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureManagedApprovedFinalization } from '../src/approved-pr-finalization.mjs';
import { reconcileManagedPullRequest } from '../src/pr-review-reconcile.mjs';
import { loadPrReviewStore } from '../src/pr-review-store.mjs';

const OLD_HEAD = 'aaaaaaaaaaaaaaaa';
const NEW_HEAD = 'bbbbbbbbbbbbbbbb';
const BRANCH = 'ai/issue-7-finalize';
const MANAGED_ID = 'octo/app#11';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-finalization-head-change-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('post-approval head movement invalidates deterministic finalization without entering browser review', (t) => {
  const root = repository(t);
  ensureManagedApprovedFinalization(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    pullRequest: {
      number: 11,
      url: 'https://example.invalid/octo/app/pull/11',
      headRefOid: OLD_HEAD,
      headRefName: BRANCH,
    },
    state: {
      branch: BRANCH,
      worktreePath: '/tmp/worktree',
      workspaceId: 'workspace-1',
      coderAgentId: 'agent-1',
    },
    headSha: OLD_HEAD,
    approvalSource: 'harness-review',
  });

  const before = loadPrReviewStore(root);
  const imported = before.reviewJobs.find((job) => job.reviewRequestId.startsWith('approved-finalization:'));
  assert.ok(imported);
  assert.equal(imported.state, 'completed');
  assert.equal(imported.result, 'approved');
  assert.equal(imported.headSha, OLD_HEAD);

  const effects = [];
  const outcome = reconcileManagedPullRequest(root, MANAGED_ID, {
    now: Date.parse('2026-08-10T17:00:00.000Z'),
    snapshot: {
      number: 11,
      state: 'OPEN',
      headRefOid: NEW_HEAD,
      labels: [],
      comments: [],
      reviews: [],
    },
    effectRunner: (_root, _managedId, requested) => {
      effects.push(...requested);
      return [];
    },
  });

  const after = loadPrReviewStore(root);
  const managed = after.managedPullRequests.find((record) => record.id === MANAGED_ID);
  assert.ok(managed);
  assert.equal(outcome.headChanged, true);
  assert.equal(outcome.state, 'failed');
  assert.equal(managed.reviewState, 'failed');
  assert.equal(managed.currentHeadSha, NEW_HEAD);
  assert.equal(managed.lastCompletedReviewSha, OLD_HEAD);
  assert.match(
    after.history.at(-1)?.reason || '',
    /Exact-head approval is invalid; a fresh workflow review is required/,
  );

  const newHeadBrowserJobs = after.reviewJobs.filter((job) => job.headSha === NEW_HEAD);
  assert.equal(newHeadBrowserJobs.length, 0);
  assert.equal(after.reviewJobs.filter((job) => job.state === 'queued').length, 0);
  assert.equal(after.reviewJobs.filter((job) => job.state === 'submitting').length, 0);
  assert.equal(after.reviewJobs.filter((job) => job.state === 'awaiting_result').length, 0);
  assert.equal(effects.length, 0);
});
