import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prReviewCommand } from '../src/cli.mjs';
import { importManagedPullRequest } from '../src/pr-review-import.mjs';
import { nextDueReview } from '../src/pr-review-queue.mjs';
import { reconcileManagedPullRequest } from '../src/pr-review-reconcile.mjs';
import { reviewWorkerPath } from '../src/pr-review-scheduler.mjs';
import {
  loadPrReviewStore,
  mutatePrReviewStore,
  savePrAutomationConfig,
} from '../src/pr-review-store.mjs';
import { loadIssueLifecycle, loadRun, saveConfig } from '../src/state.mjs';
import { webChatGptFullReviewMetadata } from '../src/web-chatgpt-full-review.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD = 'fedcba9876543210fedcba9876543210fedcba98';

function fixture(t, { quickMaxRounds = 3 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-import-staged-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  saveConfig(root, {
    baseBranch: 'main',
    models: { reviewer: 'provider/light-model' },
    review: { workflow: 'quick-web-chatgpt', quickMaxRounds, fullMaxRounds: 3 },
  });
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true, projectConversationUrl: 'https://chatgpt.com/c/imported' },
    reviewQueue: { paused: false },
  });
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
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
  };
  const issue = { number: 101, title: 'Imported review', body: 'Acceptance criteria.' };
  const imported = importManagedPullRequest(root, { id: 'Owner/Repo#45' }, {
    repositoryReader: () => ({ nameWithOwner: 'owner/repo' }),
    prReader: () => pr,
    issueReader: () => issue,
    ensureLabels: false,
    setLabels: false,
    now: 1000,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, pr, issue, managed: imported.managed };
}

function reviewNow(root, pr, issue, lightRunner, snapshotReader = () => pr, labelSetter) {
  return prReviewCommand(root, {
    _: ['pr-review', 'review-now'],
    id: 'OWNER/REPO#45',
  }, {
    snapshotReader,
    issueReader: () => issue,
    lightRunner,
    labelSetter,
  });
}

test('fresh imported review runs Light first and queues exact-head Web ChatGPT Full without lifecycle state', async (t) => {
  const { root, pr, issue } = fixture(t);
  const result = await reviewNow(root, pr, issue, () => ({
    result: 'pass',
    summary: 'Light review passed.',
    findings: [],
  }));

  assert.equal(result.staged, true);
  assert.equal(result.lightReview.event.stage, 'quick');
  assert.equal(result.lightReview.decision.action, 'quick-passed');
  assert.equal(result.reviewJob.headSha, HEAD);
  assert.equal(result.metadata.stage, 'full');
  assert.equal(result.metadata.headSha, HEAD);
  assert.equal(webChatGptFullReviewMetadata(root, result.reviewJob.id).headSha, HEAD);
  assert.match(reviewWorkerPath(root, result.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);

  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.length, 1);
  assert.equal(store.managedPullRequests[0].workspaceId, null);
  assert.equal(store.managedPullRequests[0].worktreePath, null);
  assert.equal(store.managedPullRequests[0].coderAgentId, null);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(loadIssueLifecycle(root, 101), []);
});

test('Light changes hold the imported PR, own labels, and reject same-head retries', async (t) => {
  const { root, pr, issue } = fixture(t);
  const labelCalls = [];
  const first = await reviewNow(root, pr, issue, () => ({
    result: 'changes',
    summary: 'Repair is required.',
    findings: [{ severity: 'blocking', message: 'Repair the imported head.' }],
  }), undefined, (repositoryRoot, pullRequestNumber, labels) => {
    labelCalls.push({ repositoryRoot, pullRequestNumber, labels });
    return { changed: true };
  });
  assert.equal(first.lightReview.decision.action, 'repair');
  assert.equal(first.reviewJob, null);
  assert.equal(first.metadata, null);

  const before = loadPrReviewStore(root);
  await assert.rejects(
    () => reviewNow(root, pr, issue, () => ({ result: 'pass', summary: 'Unexpected retry.', findings: [] })),
    /new exact PR head after changes were requested/,
  );
  const after = loadPrReviewStore(root);
  assert.equal(after.managedPullRequests[0].reviewState, 'changes_requested');
  assert.equal(after.managedPullRequests[0].reviewRound, before.managedPullRequests[0].reviewRound);
  assert.equal(after.managedPullRequests[0].stagedReviewEvents.length, 1);
  assert.equal(after.reviewJobs.length, 0);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(labelCalls, [{
    repositoryRoot: root,
    pullRequestNumber: 45,
    labels: {
      add: ['paseo:changes-requested'],
      remove: ['paseo:review-queued', 'paseo:reviewing', 'paseo:fixing', 'paseo:review-failed'],
    },
  }]);
});

test('a Light retry invalidates any queued Full review on changes or stale results', async (t) => {
  const changed = fixture(t);
  const passed = await reviewNow(changed.root, changed.pr, changed.issue, () => ({
    result: 'pass', summary: 'Light review passed.', findings: [],
  }));
  const changedRetry = await reviewNow(changed.root, changed.pr, changed.issue, () => ({
    result: 'changes', summary: 'Repair is required.', findings: [],
  }), undefined, () => ({ changed: true }));
  const changedStore = loadPrReviewStore(changed.root);
  assert.equal(changedRetry.lightReview.decision.action, 'repair');
  assert.equal(changedStore.reviewJobs[0].id, passed.reviewJob.id);
  assert.equal(changedStore.reviewJobs[0].state, 'superseded');
  assert.equal(nextDueReview(changedStore, Date.now()), null);
  assert.equal(changedStore.managedPullRequests[0].reviewState, 'changes_requested');

  const stale = fixture(t);
  const stalePassed = await reviewNow(stale.root, stale.pr, stale.issue, () => ({
    result: 'pass', summary: 'Light review passed.', findings: [],
  }));
  const staleRetry = await reviewNow(stale.root, stale.pr, stale.issue, () => {
    stale.pr.headRefOid = NEXT_HEAD;
    return { result: 'pass', summary: 'The head changed during Light.', findings: [] };
  });
  const staleStore = loadPrReviewStore(stale.root);
  assert.equal(staleRetry.lightReview.event.result, 'stale');
  assert.equal(staleStore.reviewJobs.find((job) => job.id === stalePassed.reviewJob.id).state, 'superseded');
  assert.equal(nextDueReview(staleStore, Date.now()), null);
});

test('exhausted Light changes remain a repair hold instead of handing off on the same head', async (t) => {
  const { root, pr, issue } = fixture(t, { quickMaxRounds: 1 });
  const first = await reviewNow(root, pr, issue, () => ({
    result: 'changes',
    summary: 'The final Light round still needs repair.',
    findings: [{ severity: 'blocking', message: 'Repair the imported head.' }],
  }), undefined, () => ({ changed: true }));

  assert.equal(first.lightReview.decision.action, 'repair');
  assert.equal(first.lightReview.decision.exhausted, true);
  assert.equal(first.reviewJob, null);
  assert.equal(first.metadata, null);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);
  await assert.rejects(
    () => reviewNow(root, pr, issue, () => ({ result: 'pass', summary: 'Unexpected retry.', findings: [] })),
    /new exact PR head after changes were requested/,
  );
});

test('a PR that closes during Light cannot enter Full review at the unchanged head', async (t) => {
  const { root, pr, issue } = fixture(t);
  const result = await reviewNow(root, pr, issue, () => {
    pr.state = 'CLOSED';
    return { result: 'pass', summary: 'The PR closed during Light.', findings: [] };
  });

  assert.equal(result.lightReview.event.result, 'stale');
  assert.equal(result.reviewJob, null);
  assert.equal(result.metadata, null);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);
});

test('a stale Light result and a pre-Light head advance reset to staged Light', async (t) => {
  const stale = fixture(t);
  const staleResult = await reviewNow(stale.root, stale.pr, stale.issue, () => {
    stale.pr.headRefOid = NEXT_HEAD;
    return { result: 'pass', summary: 'Head changed during Light.', findings: [] };
  });
  assert.equal(staleResult.lightReview.event.result, 'stale');
  assert.equal(staleResult.reviewJob, null);
  assert.equal(loadPrReviewStore(stale.root).reviewJobs.length, 0);

  const staleReconciled = reconcileManagedPullRequest(stale.root, stale.managed.id, {
    snapshot: stale.pr,
    now: 3000,
    effectRunner: () => [],
  });
  assert.equal(staleReconciled.stagedReviewQueued, true);
  assert.equal(loadPrReviewStore(stale.root).reviewJobs.length, 0);
  assert.equal(loadPrReviewStore(stale.root).managedPullRequests[0].currentHeadSha, NEXT_HEAD);

  const staleNext = await reviewNow(stale.root, stale.pr, stale.issue, () => ({
    result: 'pass',
    summary: 'Replacement Light head passed.',
    findings: [],
  }));
  assert.equal(staleNext.reviewJob.headSha, NEXT_HEAD);
  assert.equal(staleNext.metadata.headSha, NEXT_HEAD);
  assert.match(reviewWorkerPath(stale.root, staleNext.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);

  const preLight = fixture(t);
  preLight.pr.headRefOid = NEXT_HEAD;
  const preLightReconciled = reconcileManagedPullRequest(preLight.root, preLight.managed.id, {
    snapshot: preLight.pr,
    now: 3000,
    effectRunner: () => [],
  });
  assert.equal(preLightReconciled.stagedReviewQueued, true);
  assert.equal(loadPrReviewStore(preLight.root).reviewJobs.length, 0);

  const preLightNext = await reviewNow(preLight.root, preLight.pr, preLight.issue, () => ({
    result: 'pass',
    summary: 'First Light review passed on the current head.',
    findings: [],
  }));
  assert.equal(preLightNext.reviewJob.headSha, NEXT_HEAD);
  assert.equal(preLightNext.metadata.headSha, NEXT_HEAD);
  assert.equal(loadRun(preLight.root, 101), null);
  assert.deepEqual(loadIssueLifecycle(preLight.root, 101), []);
});

test('imported Full changes are an external repair hold and own the label effect', async (t) => {
  const { root, pr, issue } = fixture(t);
  const staged = await reviewNow(root, pr, issue, () => ({
    result: 'pass',
    summary: 'Light review passed.',
    findings: [],
  }));
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests[0];
    const job = store.reviewJobs[0];
    managed.reviewState = 'awaiting_result';
    managed.activeReviewRequestId = job.reviewRequestId;
    job.state = 'awaiting_result';
  });
  const marker = `<!-- paseo-review:v1\n${JSON.stringify({
    reviewRequestId: staged.reviewJob.reviewRequestId,
    repository: 'owner/repo',
    pullRequestNumber: 45,
    issueNumber: 101,
    headSha: HEAD,
    reviewRound: 1,
    stage: 'full',
    round: 1,
    promptVersion: 2,
    result: 'changes_requested',
  })}\n-->\nRepair the imported PR.`;
  const effects = [];
  const outcome = reconcileManagedPullRequest(root, staged.managed.id, {
    snapshot: { ...pr, labels: [], comments: [{ id: 1, body: marker }] },
    effectRunner: (_root, _managedId, nextEffects) => {
      effects.push(...nextEffects);
      return [];
    },
  });

  assert.equal(outcome.review.result, 'changes_requested');
  assert.equal(loadPrReviewStore(root).fixJobs[0].state, 'paused');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'changes_requested');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(effects, [{
    type: 'set-review-labels',
    pullRequestNumber: 45,
    add: ['paseo:changes-requested'],
    remove: ['paseo:reviewing', 'paseo:review-queued', 'paseo:review-failed'],
  }]);
});

test('an imported Full head advance invalidates H1 and returns to Light before H2 Full metadata', async (t) => {
  const { root, pr, issue, managed } = fixture(t);
  const staged = await reviewNow(root, pr, issue, () => ({
    result: 'pass',
    summary: 'Light review passed on H1.',
    findings: [],
  }));
  assert.equal(staged.metadata.headSha, HEAD);

  pr.headRefOid = NEXT_HEAD;
  const reconciled = reconcileManagedPullRequest(root, managed.id, {
    snapshot: pr,
    now: 3000,
    effectRunner: () => [],
  });
  const store = loadPrReviewStore(root);
  const oldJob = store.reviewJobs.find((job) => job.headSha === HEAD);
  assert.equal(reconciled.stagedReviewQueued, true);
  assert.equal(store.reviewJobs.some((job) => job.headSha === NEXT_HEAD), false);
  assert.equal(oldJob.state, 'cancelled');
  assert.equal(webChatGptFullReviewMetadata(root, store.reviewJobs.find((job) => job.headSha === NEXT_HEAD)?.id), null);

  const fresh = await reviewNow(root, pr, issue, () => ({
    result: 'pass',
    summary: 'Light review passed on H2.',
    findings: [],
  }));
  assert.equal(fresh.reviewJob.headSha, NEXT_HEAD);
  assert.equal(fresh.metadata.headSha, NEXT_HEAD);
});
