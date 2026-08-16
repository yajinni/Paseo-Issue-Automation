import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateApprovedReviewGate, finalizeApprovedBrowserReview } from '../src/pr-review-finalize.mjs';
import { applyMergedIssueEffect, reconcileManagedPullRequest } from '../src/pr-review-reconcile.mjs';
import { createFixJobInStore, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { loadRun, saveConfig } from '../src/state.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-pr-review-import-lifecycle-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  saveConfig(root, { baseBranch: 'main' });
  savePrAutomationConfig(root, { reviewQueue: { paused: true } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registration = registerManagedPullRequest(root, {
    repository: 'owner/repo',
    issueNumber: 101,
    issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    branchName: 'feature/import-me',
    baseBranch: 'main',
    currentHeadSha: HEAD,
    provenance: {
      type: 'manual-import',
      importedAt: new Date(1000).toISOString(),
      repository: 'owner/repo',
      pullRequestNumber: 45,
      issueNumber: 101,
      headSha: HEAD,
      headBranch: 'feature/import-me',
      baseBranch: 'main',
    },
  }, { now: 1000 });
  const pr = {
    number: 45,
    url: 'https://github.com/owner/repo/pull/45',
    state: 'OPEN',
    headRefOid: HEAD,
    headRefName: 'feature/import-me',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
  };
  return { root, managed: registration.managed, pr };
}

function successfulRunner() {
  return { ok: true, stdout: '', stderr: '' };
}

function approvedMarker(reviewRequestId) {
  return `<!-- paseo-review:v1\n${JSON.stringify({
    reviewRequestId,
    repository: 'owner/repo',
    pullRequestNumber: 45,
    issueNumber: 101,
    headSha: HEAD,
    reviewRound: 1,
    promptVersion: 1,
    result: 'approved',
  })}\n-->\nApproved exact head.`;
}

function seedAwaitingImportedReview(root, managed) {
  const reviewRequestId = 'review-imported-merged';
  mutatePrReviewStore(root, (store) => {
    const record = store.managedPullRequests[0];
    record.reviewState = 'awaiting_result';
    record.activeReviewRequestId = reviewRequestId;
    store.reviewJobs.push({
      id: reviewRequestId,
      managedPullRequestId: managed.id,
      repository: managed.repository,
      pullRequestNumber: managed.pullRequestNumber,
      headSha: HEAD,
      promptVersion: 1,
      reviewRound: 1,
      reviewRequestId,
      state: 'awaiting_result',
      queuePosition: 1,
      priority: 0,
      dueAt: new Date(1000).toISOString(),
      attempts: 1,
      createdAt: new Date(1000).toISOString(),
      updatedAt: new Date(1000).toISOString(),
    });
  });
  return reviewRequestId;
}

function mergedSnapshot(pr, marker) {
  return {
    ...pr,
    state: 'MERGED',
    mergedAt: '2026-08-10T04:10:00Z',
    labels: [],
    comments: [{ id: 7788, body: marker, createdAt: '2026-08-10T04:09:00Z' }],
    reviews: [],
    body: 'Closes #101',
    closingIssuesReferences: [{ number: 101 }],
  };
}

test('imported approval uses exact-head CI/base evidence without run or workspace state', (t) => {
  const { root, managed, pr } = fixture(t);
  const job = {
    headSha: HEAD,
    reviewRequestId: 'review-imported-full',
  };
  const gate = evaluateApprovedReviewGate(root, managed, job, pr, {
    config: { baseBranch: 'main' },
    runState: null,
    runner: successfulRunner,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.imported, true);
  assert.equal(gate.validation.source, 'manual-import');
  assert.equal(loadRun(root, 101), null);
  assert.equal(managed.workspaceId, null);
  assert.equal(managed.worktreePath, null);
});

test('imported approval finalizes the managed record and never creates an automation run', (t) => {
  const { root, managed, pr } = fixture(t);
  const job = {
    id: 'review-imported-full',
    headSha: HEAD,
    reviewRequestId: 'review-imported-full',
    state: 'awaiting_result',
    reviewRound: 1,
  };
  const finalized = finalizeApprovedBrowserReview(root, managed, job, {
    pr,
    gate: { ok: true, imported: true, commit: HEAD, validation: { result: 'PASS', commit: HEAD, source: 'manual-import' } },
  });
  assert.equal(finalized.mode, 'managed-finalization');
  assert.equal(finalized.imported, true);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'ready_to_merge');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].lastValidatedReviewSha, HEAD);
  assert.equal(loadRun(root, 101), null);
});

test('first imported merged reconciliation completes only with preserved validation evidence', (t) => {
  const { root, managed, pr } = fixture(t);
  savePrAutomationConfig(root, { githubActions: { allowChatGPTMerge: true } });
  const reviewRequestId = seedAwaitingImportedReview(root, managed);
  mutatePrReviewStore(root, (store) => {
    store.managedPullRequests[0].lastValidatedReviewSha = HEAD;
  });

  let pendingEffects;
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 5000,
    snapshot: mergedSnapshot(pr, approvedMarker(reviewRequestId)),
    effectRunner(_root, _managedId, effects) {
      pendingEffects = effects;
      return [];
    },
  });

  assert.equal(outcome.state, 'merged');
  assert.equal(outcome.reviewVerified, true);
  assert.equal(pendingEffects.find((effect) => effect.type === 'verify-merged-issue').reviewVerified, true);
  const stored = loadPrReviewStore(root);
  assert.equal(stored.managedPullRequests[0].lastValidatedReviewSha, HEAD);
  assert.equal(stored.reviewJobs[0].state, 'completed');

  const completion = applyMergedIssueEffect(root, pendingEffects.find((effect) => effect.type === 'verify-merged-issue'), {
    issueReader: () => ({ number: 101, state: 'CLOSED' }),
    issueLabelCleaner: () => ({ changed: false }),
  });
  assert.equal(completion.issueClosed, true);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].lifecycleCompletionPending, false);
});

test('first imported merged reconciliation fails closed when validation evidence is absent', (t) => {
  const { root, managed, pr } = fixture(t);
  const reviewRequestId = seedAwaitingImportedReview(root, managed);
  let pendingEffects;
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 5000,
    snapshot: mergedSnapshot(pr, approvedMarker(reviewRequestId)),
    effectRunner(_root, _managedId, effects) {
      pendingEffects = effects;
      return [];
    },
  });

  assert.equal(outcome.state, 'merged');
  assert.equal(outcome.reviewVerified, false);
  assert.equal(pendingEffects.find((effect) => effect.type === 'verify-merged-issue').reviewVerified, false);
  const stored = loadPrReviewStore(root);
  assert.equal(stored.managedPullRequests[0].reviewEvidenceMissing, true);
  assert.equal(stored.reviewJobs[0].state, 'cancelled');
});

test('imported changes requested findings are preserved as an operator repair hold', (t) => {
  const { root } = fixture(t);
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests[0];
    const reviewJob = {
      id: 'review-imported-light',
      managedPullRequestId: managed.id,
      repository: managed.repository,
      pullRequestNumber: managed.pullRequestNumber,
      headSha: HEAD,
      promptVersion: 1,
      reviewRound: 1,
      reviewRequestId: 'review-imported-light',
      state: 'awaiting_result',
      queuePosition: 1,
      priority: 0,
      dueAt: new Date(1000).toISOString(),
      attempts: 1,
      createdAt: new Date(1000).toISOString(),
      updatedAt: new Date(1000).toISOString(),
    };
    store.reviewJobs.push(reviewJob);
    const fix = createFixJobInStore(store, managed, reviewJob, 'Repair the imported PR exact head.', {
      reviewResult: 'changes_requested',
      now: 2000,
    });
    assert.equal(fix.state, 'paused');
    assert.equal(fix.findings, 'Repair the imported PR exact head.');
    assert.equal(managed.reviewState, 'changes_requested');
    assert.equal(managed.workspaceId, null);
  });
  const stored = loadPrReviewStore(root);
  assert.equal(stored.fixJobs[0].state, 'paused');
  assert.equal(stored.managedPullRequests[0].lastError.includes('external same-PR repair'), true);
  assert.equal(loadRun(root, 101), null);
});

test('imported approval remains blocked on stale head or failed CI', (t) => {
  const { root, managed, pr } = fixture(t);
  const stale = evaluateApprovedReviewGate(root, managed, { headSha: HEAD, reviewRequestId: 'stale' }, {
    ...pr,
    headRefOid: 'fedcba9876543210fedcba9876543210fedcba98',
  }, { config: { baseBranch: 'main' }, runner: successfulRunner });
  assert.equal(stale.stale, true);
  const failed = evaluateApprovedReviewGate(root, managed, { headSha: HEAD, reviewRequestId: 'failed' }, {
    ...pr,
    statusCheckRollup: [{ name: 'CI', conclusion: 'FAILURE' }],
  }, { config: { baseBranch: 'main' }, runner: successfulRunner });
  assert.equal(failed.repair, true);
});

test('imported merge completion records guarded lifecycle state without an issue run', (t) => {
  const { root, managed, pr } = fixture(t);
  const result = applyMergedIssueEffect(root, {
    managedId: managed.id,
    issueNumber: managed.issueNumber,
    pullRequestNumber: managed.pullRequestNumber,
    pullRequestUrl: pr.url,
    headSha: HEAD,
    mergedAt: new Date(3000).toISOString(),
    reviewVerified: true,
    verifyIssueClosure: true,
    explicitAssociation: true,
  }, {
    issueReader: () => ({ number: managed.issueNumber, state: 'CLOSED' }),
    issueLabelCleaner: () => ({ changed: false }),
  });
  assert.equal(result.issueClosed, true);
  assert.equal(loadRun(root, managed.issueNumber), null);
  const stored = loadPrReviewStore(root).managedPullRequests[0];
  assert.equal(stored.lifecycleCompletionPending, false);
  assert.equal(stored.reviewEvidenceMissing, false);
});
