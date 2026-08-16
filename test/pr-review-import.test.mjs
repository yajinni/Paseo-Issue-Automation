import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prReviewCommand } from '../src/cli.mjs';
import { importManagedPullRequest } from '../src/pr-review-import.mjs';
import { enqueueManagedReview } from '../src/pr-review-queue.mjs';
import { reviewWorkerPath } from '../src/pr-review-scheduler.mjs';
import { loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { saveConfig } from '../src/state.mjs';
import { webChatGptFullReviewMetadata } from '../src/web-chatgpt-full-review.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD = 'fedcba9876543210fedcba9876543210fedcba98';

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

test('repeating an approved manual import preserves unchanged-head validation evidence', (t) => {
  const { root, options, pr } = fixture(t);
  importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  mutatePrReviewStore(root, (store) => {
    store.managedPullRequests[0].lastValidatedReviewSha = HEAD;
  });

  const repeated = importManagedPullRequest(root, { id: 'owner/repo#45' }, { ...options, now: 2000 });
  assert.equal(repeated.managed.lastValidatedReviewSha, HEAD);

  const advanced = importManagedPullRequest(root, { id: 'owner/repo#45' }, {
    ...options,
    now: 3000,
    prReader: () => ({ ...pr, headRefOid: NEXT_HEAD }),
  });
  assert.equal(advanced.managed.lastValidatedReviewSha, null);
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

test('public review-now runs imported Light review before queuing exact-head Web ChatGPT full review', async (t) => {
  const { root, options, pr, issue } = fixture(t);
  saveConfig(root, {
    baseBranch: 'main',
    models: { reviewer: 'provider/light-model' },
    review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 1, fullMaxRounds: 3 },
  });
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true, projectConversationUrl: 'https://chatgpt.com/c/example' },
    reviewQueue: { paused: false },
  });
  const imported = importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  assert.equal(imported.reviewJob, null);

  const calls = [];
  const result = await prReviewCommand(root, {
    _: ['pr-review', 'review-now'],
    id: 'owner/repo#45',
  }, {
    snapshotReader: () => pr,
    issueReader: () => issue,
    lightRunner(command, args, runnerOptions) {
      calls.push({ command, args, runnerOptions });
      return { result: 'pass', summary: 'Light review passed.', findings: [] };
    },
  });

  assert.equal(result.staged, true);
  assert.equal(result.lightReview.event.stage, 'quick');
  assert.equal(result.lightReview.decision.action, 'quick-passed');
  assert.equal(result.reviewJob.headSha, HEAD);
  assert.equal(result.metadata.stage, 'full');
  assert.equal(result.metadata.stageRound, 1);
  assert.match(reviewWorkerPath(root, result.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(webChatGptFullReviewMetadata(root, result.reviewJob.id).headSha, HEAD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'paseo');
  assert.equal(calls[0].args.includes('--workspace'), false);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 1);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].worktreePath, null);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].stagedReviewEvents[0].stage, 'quick');
  assert.equal(issue.number, 101);
  assert.equal(pr.headRefOid, HEAD);
});

test('imported Light exhaustion hands off its findings to exact-head Full review metadata', async (t) => {
  const { root, options, pr } = fixture(t);
  saveConfig(root, {
    baseBranch: 'main',
    models: { reviewer: 'provider/light-model' },
    review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 1, fullMaxRounds: 3 },
  });
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true },
    reviewQueue: { paused: false },
  });
  importManagedPullRequest(root, { id: 'owner/repo#45' }, options);

  const result = await prReviewCommand(root, {
    _: ['pr-review', 'review-now'],
    id: 'owner/repo#45',
  }, {
    snapshotReader: () => pr,
    issueReader: () => ({ number: 101, title: 'Issue', body: 'Acceptance criteria.' }),
    lightRunner: () => ({
      result: 'changes',
      summary: 'The Light review found a blocking issue.',
      findings: [{ severity: 'blocking', message: 'Recheck the imported edge case.' }],
    }),
  });

  assert.equal(result.lightReview.decision.action, 'handoff');
  assert.equal(result.metadata.stage, 'full');
  assert.equal(result.metadata.headSha, HEAD);
  assert.equal(result.metadata.quickFindings[0].message, 'Recheck the imported edge case.');
  assert.match(reviewWorkerPath(root, result.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
});

test('imported staged Light review does not queue Full review for stale or non-exhausted changes', async (t) => {
  for (const mode of ['stale', 'changes']) {
    const { root, options, pr } = fixture(t);
    saveConfig(root, {
      baseBranch: 'main',
      models: { reviewer: 'provider/light-model' },
      review: { workflow: 'quick-web-chatgpt', quickMaxRounds: mode === 'changes' ? 3 : 1, fullMaxRounds: 3 },
    });
    savePrAutomationConfig(root, {
      enabled: true,
      browserReview: { enabled: true },
      reviewQueue: { paused: false },
    });
    importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
    let reads = 0;
    const result = await prReviewCommand(root, {
      _: ['pr-review', 'review-now'],
      id: 'owner/repo#45',
    }, {
      snapshotReader: () => {
        reads += 1;
        return reads > 1 && mode === 'stale' ? { ...pr, headRefOid: NEXT_HEAD } : pr;
      },
      issueReader: () => ({ number: 101, title: 'Issue', body: 'Acceptance criteria.' }),
      lightRunner: () => ({
        result: mode === 'stale' ? 'pass' : 'changes',
        summary: 'The Light review found a blocking issue.',
        findings: [{ severity: 'blocking', message: 'The blocking issue.' }],
      }),
    });

    assert.equal(result.reviewJob, null);
    assert.equal(result.metadata, null);
    assert.equal(result.lightReview.event.result, mode === 'stale' ? 'stale' : 'changes');
    assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);
    assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
  }
});
