import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCodingCount } from '../src/fix-jobs.mjs';
import { normalizeManagedPullRequest } from '../src/pr-review-store.mjs';

test('coding capacity fails closed when GitHub cannot report running issues', () => {
  assert.throws(() => activeCodingCount('/repo', {
    jsonRunner: () => null,
    storeLoader: () => ({ fixJobs: [] }),
  }), /Could not confirm the active issue-coding count/);
});

test('coding capacity combines GitHub issue workers and active fix workers', () => {
  const active = activeCodingCount('/repo', {
    jsonRunner: () => [{ number: 1 }, { number: 2 }],
    storeLoader: () => ({ fixJobs: [{ state: 'fixing' }, { state: 'queued' }] }),
  });
  assert.equal(active, 3);
});

test('managed PR normalization preserves a cleared queue position', () => {
  const normalized = normalizeManagedPullRequest({
    id: 'owner/repo#1',
    repository: 'owner/repo',
    issueNumber: 1,
    pullRequestNumber: 1,
    pullRequestUrl: 'https://github.com/owner/repo/pull/1',
    branchName: 'ai/issue-1',
    currentHeadSha: 'abcdef123',
    reviewState: 'paused',
    queuePosition: null,
  });
  assert.equal(normalized.queuePosition, null);
});
