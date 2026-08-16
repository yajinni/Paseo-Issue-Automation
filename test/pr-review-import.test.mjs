import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importManagedPullRequest } from '../src/pr-review-import.mjs';
import { enqueueManagedReview } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { saveConfig } from '../src/state.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-pr-review-import-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  saveConfig(root, { baseBranch: 'main' });
  savePrAutomationConfig(root, { reviewQueue: { paused: true } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pr = {
    number: 45,
    url: 'https://github.com/owner/repo/pull/45',
    state: 'OPEN',
    isCrossRepository: false,
    headRefOid: HEAD,
    headRefName: 'feature/import-me',
    headRepository: { nameWithOwner: 'owner/repo' },
    baseRefName: 'main',
    closingIssuesReferences: [{ number: 101, repository: { nameWithOwner: 'owner/repo' } }],
    ...overrides,
  };
  const issue = { number: 101, url: 'https://github.com/owner/repo/issues/101', state: 'OPEN' };
  return {
    root,
    pr,
    issue,
    options: {
      repositoryReader: () => ({ nameWithOwner: 'owner/repo' }),
      prReader: () => pr,
      issueReader: () => issue,
      ensureLabels: false,
      setLabels: false,
      now: 1000,
    },
  };
}

test('manual import infers one same-repository issue and records provenance', (t) => {
  const { root, options } = fixture(t);
  const result = importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  assert.equal(result.imported, true);
  assert.equal(result.inferredIssue, true);
  assert.equal(result.managed.provenance.type, 'manual-import');
  assert.equal(result.managed.provenance.headSha, HEAD);
  assert.equal(result.managed.baseBranch, 'main');
  assert.equal(loadPrReviewStore(root).managedPullRequests.length, 1);
});

test('repeating the same manual import is idempotent and preserves its timestamp', (t) => {
  const { root, options } = fixture(t);
  const first = importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  const second = importManagedPullRequest(root, { id: 'owner/repo#45' }, { ...options, now: 2000 });
  assert.equal(second.imported, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.managed.provenance.importedAt, first.managed.provenance.importedAt);
  assert.equal(loadPrReviewStore(root).managedPullRequests.length, 1);
});

test('import rejects forks, wrong bases, stale heads, and ambiguous issue associations', (t) => {
  const cases = [
    { pr: { isCrossRepository: true }, message: /Fork pull requests/ },
    { pr: { baseRefName: 'develop' }, message: /targets develop/ },
    { pr: { headRefOid: 'not-a-sha' }, message: /missing or stale current head/ },
    { pr: { closingIssuesReferences: [{ number: 101, repository: { nameWithOwner: 'owner/repo' } }, { number: 102, repository: { nameWithOwner: 'owner/repo' } }] }, message: /multiple associated issues/ },
  ];
  for (const item of cases) {
    const { root, options } = fixture(t, item.pr);
    assert.throws(() => importManagedPullRequest(root, { id: 'owner/repo#45' }, options), item.message);
  }
});

test('explicit issue association is required when the PR has no safe reference', (t) => {
  const { root, options, issue } = fixture(t, { closingIssuesReferences: [] });
  assert.throws(() => importManagedPullRequest(root, { id: 'owner/repo#45' }, options), /pass --issue explicitly/);
  const result = importManagedPullRequest(root, { id: 'owner/repo#45', issueNumber: issue.number }, options);
  assert.equal(result.inferredIssue, false);
});

test('normal GitHub issue-reference repository objects support inferred and explicit association', (t) => {
  const repository = { name: 'repo', owner: { login: 'owner' } };
  const { root, options, issue } = fixture(t, {
    closingIssuesReferences: [{ number: 101, repository }],
  });
  const inferred = importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  assert.equal(inferred.inferredIssue, true);

  const explicit = importManagedPullRequest(root, { id: 'owner/repo#45', issueNumber: issue.number }, options);
  assert.equal(explicit.inferredIssue, false);
  assert.equal(explicit.idempotent, true);
});

test('an imported managed PR enters the normal review queue through review-now', (t) => {
  const { root, options } = fixture(t);
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true },
    reviewQueue: { paused: true },
  });
  importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  const review = enqueueManagedReview(root, 'owner/repo#45', { immediate: true, now: 2000 });
  assert.equal(review.state, 'queued');
  assert.equal(review.headSha, HEAD);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'queued');
});
