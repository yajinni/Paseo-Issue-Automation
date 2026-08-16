import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateApprovedReviewGate, finalizeApprovedBrowserReview } from '../src/pr-review-finalize.mjs';
import { applyMergedIssueEffect, reconcileManagedPullRequest } from '../src/pr-review-reconcile.mjs';
import { createFixJobInStore, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { prReviewCommand } from '../src/cli.mjs';
import { reviewWorkerPath } from '../src/pr-review-scheduler.mjs';
import { loadPrReviewStore, mutatePrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { loadIssueLifecycle, loadRun, saveConfig, saveRun } from '../src/state.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD = 'fedcba9876543210fedcba9876543210fedcba98';

function fixture(t, { withGitRefs = false, manualImport = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-pr-review-import-lifecycle-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const branchName = manualImport ? 'feature/import-me' : 'ai/issue-101';
  if (withGitRefs) {
    const origin = path.join(root, 'origin.git');
    execFileSync('git', ['init', '--bare', '--quiet', origin], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Paseo Test'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: root });
    execFileSync('git', ['branch', '--quiet', '-M', 'main'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: root });
    execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '--quiet', '-b', branchName], { cwd: root });
    execFileSync('git', ['push', '--quiet', 'origin', branchName], { cwd: root });
  }
  saveConfig(root, { baseBranch: 'main' });
  savePrAutomationConfig(root, { reviewQueue: { paused: true } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registration = registerManagedPullRequest(root, {
    repository: 'owner/repo',
    issueNumber: 101,
    issueUrl: 'https://github.com/owner/repo/issues/101',
    pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45',
    branchName,
    baseBranch: 'main',
    currentHeadSha: HEAD,
    ...(manualImport ? {
      provenance: {
        type: 'manual-import',
        importedAt: new Date(1000).toISOString(),
        repository: 'owner/repo',
        pullRequestNumber: 45,
        issueNumber: 101,
        headSha: HEAD,
        headBranch: branchName,
        baseBranch: 'main',
      },
    } : {
      worktreePath: root,
      workspaceId: 'workspace-101',
      coderAgentId: 'coder-101',
    }),
  }, { now: 1000 });
  const pr = {
    number: 45,
    url: 'https://github.com/owner/repo/pull/45',
    state: 'OPEN',
    headRefOid: HEAD,
    headRefName: branchName,
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

function changesRequestedMarker(reviewRequestId, overrides = {}) {
  return `<!-- paseo-review:v1\n${JSON.stringify({
    reviewRequestId,
    repository: 'owner/repo',
    pullRequestNumber: 45,
    issueNumber: 101,
    headSha: HEAD,
    reviewRound: 1,
    promptVersion: 1,
    result: 'changes_requested',
    ...overrides,
  })}\n-->\nChanges requested.`;
}

function stagedReviewConfig(root) {
  saveConfig(root, {
    baseBranch: 'main',
    models: { reviewer: 'provider/light-model' },
    review: { workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 3 },
  });
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true },
    reviewQueue: { paused: false },
  });
}

function reviewNow(root, pr, lightRunner) {
  return prReviewCommand(root, {
    _: ['pr-review', 'review-now'],
    id: 'OWNER/REPO#45',
  }, {
    snapshotReader: () => pr,
    issueReader: () => ({ number: 101, title: 'Issue', body: 'Acceptance criteria.' }),
    lightRunner,
  });
}

function seedAwaitingReview(root, managed, reviewRequestId = 'review-imported-merged') {
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

test('imported approval with ChatGPT merge preserves validation for merged lifecycle completion', (t) => {
  const { root, managed, pr } = fixture(t, { withGitRefs: true });
  savePrAutomationConfig(root, { githubActions: { allowChatGPTMerge: true } });
  const reviewRequestId = seedAwaitingReview(root, managed);

  const approvedOpenSnapshot = {
    ...pr,
    comments: [{ id: 7788, body: approvedMarker(reviewRequestId), createdAt: '2026-08-10T04:09:00Z' }],
    reviews: [],
  };
  const openOutcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: approvedOpenSnapshot,
    effectRunner() {
      return [];
    },
  });
  assert.equal(openOutcome.review.result, 'approved');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].lastValidatedReviewSha, HEAD);
  assert.equal(loadRun(root, 101), null);

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

test('controller-created approval with ChatGPT merge does not invoke controller finalization', (t) => {
  const { root, managed, pr } = fixture(t, { withGitRefs: true, manualImport: false });
  savePrAutomationConfig(root, { githubActions: { allowChatGPTMerge: true } });
  saveRun(root, managed.issueNumber, {
    issueNumber: managed.issueNumber,
    issueUrl: managed.issueUrl,
    status: 'agent-running',
    phase: 'reviewing-heavy',
    reviewRuntimeStage: 'full',
    branch: managed.branchName,
    workspaceId: managed.workspaceId,
    coderAgentId: managed.coderAgentId,
    prNumber: managed.pullRequestNumber,
    prUrl: managed.pullRequestUrl,
    events: [{ event: 'validation-summary', result: 'PASS', commit: HEAD }],
    activity: [],
  });
  const reviewRequestId = seedAwaitingReview(root, managed, 'review-controller');
  let finalizationCalls = 0;
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: {
      ...pr,
      comments: [{ id: 7788, body: approvedMarker(reviewRequestId), createdAt: '2026-08-10T04:09:00Z' }],
      reviews: [],
    },
    effectRunner() {
      return [];
    },
    finalizeApprovedReview() {
      finalizationCalls += 1;
      throw new Error('Controller finalization must not run for ChatGPT-approved managed PRs.');
    },
  });

  assert.equal(outcome.review.result, 'approved');
  assert.equal(finalizationCalls, 0);
  const run = loadRun(root, managed.issueNumber);
  assert.equal(run.phase, 'reviewing-heavy');
  assert.notEqual(run.phase, 'human-review');
  assert.notEqual(run.phase, 'auto-merge-requested');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].lastValidatedReviewSha, null);
});

test('first imported merged reconciliation fails closed when validation evidence is absent', (t) => {
  const { root, managed, pr } = fixture(t);
  const reviewRequestId = seedAwaitingReview(root, managed);
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

test('exact changes-requested marker owns the label effect without a preexisting label', (t) => {
  const { root, managed, pr } = fixture(t, { manualImport: false });
  const reviewRequestId = seedAwaitingReview(root, managed, 'review-label-effect');
  let effects = [];
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: {
      ...pr,
      labels: ['paseo:reviewing'],
      comments: [{ id: 7788, body: changesRequestedMarker(reviewRequestId), createdAt: '2026-08-10T04:09:00Z' }],
      reviews: [],
    },
    effectRunner(_root, _managedId, nextEffects) {
      effects = nextEffects;
      return [];
    },
  });

  assert.equal(outcome.review.result, 'changes_requested');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'fix_queued');
  assert.deepEqual(effects, [{
    type: 'set-review-labels',
    pullRequestNumber: 45,
    add: ['paseo:changes-requested'],
    remove: ['paseo:reviewing', 'paseo:review-queued', 'paseo:review-failed'],
  }]);
});

test('exact changes-requested marker is consumed when no lifecycle labels exist', (t) => {
  const { root, managed, pr } = fixture(t, { manualImport: false });
  const reviewRequestId = seedAwaitingReview(root, managed, 'review-no-labels');
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: {
      ...pr,
      labels: [],
      comments: [{ id: 7788, body: changesRequestedMarker(reviewRequestId), createdAt: '2026-08-10T04:09:00Z' }],
      reviews: [],
    },
    effectRunner() {
      return [];
    },
  });

  assert.equal(outcome.review.result, 'changes_requested');
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'fix_queued');
});

test('changes-requested label without an exact marker does not fabricate a result', (t) => {
  const { root, managed, pr } = fixture(t, { manualImport: false });
  seedAwaitingReview(root, managed, 'review-label-without-marker');
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: {
      ...pr,
      labels: ['paseo:changes-requested'],
      comments: [],
      reviews: [],
    },
    effectRunner() {
      return [];
    },
  });

  assert.equal(outcome.review, null);
  const stored = loadPrReviewStore(root);
  assert.equal(stored.managedPullRequests[0].reviewState, 'awaiting_result');
  assert.equal(stored.fixJobs.length, 0);
});

test('wrong changes-requested marker identity is rejected even when the label exists', (t) => {
  const { root, managed, pr } = fixture(t, { manualImport: false });
  seedAwaitingReview(root, managed, 'review-strict-label-identity');
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    now: 4000,
    snapshot: {
      ...pr,
      labels: ['paseo:changes-requested'],
      comments: [{
        id: 7788,
        body: changesRequestedMarker('wrong-request', { headSha: 'fedcba9876543210fedcba9876543210fedcba98' }),
        createdAt: '2026-08-10T04:09:00Z',
      }],
      reviews: [],
    },
    effectRunner() {
      return [];
    },
  });

  assert.equal(outcome.review, null);
  const stored = loadPrReviewStore(root);
  assert.equal(stored.managedPullRequests[0].reviewState, 'awaiting_result');
  assert.equal(stored.fixJobs.length, 0);
});

test('reconciling the same changes-requested marker is idempotent', (t) => {
  const { root, managed, pr } = fixture(t, { manualImport: false });
  const reviewRequestId = seedAwaitingReview(root, managed, 'review-idempotent-changes');
  const snapshot = {
    ...pr,
    labels: ['paseo:reviewing'],
    comments: [{ id: 7788, body: changesRequestedMarker(reviewRequestId), createdAt: '2026-08-10T04:09:00Z' }],
    reviews: [],
  };
  const first = reconcileManagedPullRequest(root, managed.id, { now: 4000, snapshot, effectRunner: () => [] });
  const second = reconcileManagedPullRequest(root, managed.id, { now: 5000, snapshot, effectRunner: () => [] });

  assert.equal(first.review.result, 'changes_requested');
  assert.equal(second.review, null);
  assert.equal(loadPrReviewStore(root).fixJobs.length, 1);
});

test('imported Light changes require a new exact head before another Light round', async (t) => {
  const { root, managed, pr } = fixture(t);
  stagedReviewConfig(root);
  let lightCalls = 0;

  const first = await reviewNow(root, pr, () => {
    lightCalls += 1;
    return { result: 'changes', summary: 'Repair is required.', findings: [{ severity: 'blocking', message: 'Repair the imported head.' }] };
  });
  assert.equal(first.lightReview.decision.action, 'repair');

  const before = loadPrReviewStore(root);
  await assert.rejects(
    () => reviewNow(root, pr, () => {
      lightCalls += 1;
      return { result: 'pass', summary: 'Unexpected retry.', findings: [] };
    }),
    /new exact PR head after changes were requested/,
  );
  const after = loadPrReviewStore(root);
  assert.equal(lightCalls, 1);
  assert.equal(after.managedPullRequests[0].reviewRound, before.managedPullRequests[0].reviewRound);
  assert.equal(after.managedPullRequests[0].stagedReviewEvents.length, 1);
  assert.equal(after.reviewJobs.length, 0);
  assert.equal(after.managedPullRequests[0].currentHeadSha, HEAD);
  assert.equal(managed.workspaceId, null);
});

test('a stale imported Light head resets to staged Light before Web ChatGPT Full review', async (t) => {
  const { root, managed, pr } = fixture(t);
  stagedReviewConfig(root);

  const first = await reviewNow(root, pr, () => {
    pr.headRefOid = NEXT_HEAD;
    return { result: 'pass', summary: 'The imported head changed during Light review.', findings: [] };
  });
  assert.equal(first.lightReview.event.result, 'stale');
  assert.equal(first.reviewJob, null);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);

  const reconciled = reconcileManagedPullRequest(root, managed.id, {
    now: 3000,
    snapshot: pr,
    effectRunner: () => [],
  });
  assert.equal(reconciled.headChanged, true);
  assert.equal(reconciled.stagedReviewQueued, true);
  const staged = loadPrReviewStore(root);
  assert.equal(staged.reviewJobs.length, 0);
  assert.equal(staged.managedPullRequests[0].currentHeadSha, NEXT_HEAD);
  assert.equal(staged.managedPullRequests[0].reviewState, 'queued');
  assert.equal(staged.managedPullRequests[0].workspaceId, null);
  assert.equal(staged.managedPullRequests[0].worktreePath, null);
  assert.equal(staged.managedPullRequests[0].coderAgentId, null);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(loadIssueLifecycle(root, 101), []);

  const next = await reviewNow(root, pr, () => ({
    result: 'pass',
    summary: 'The replacement head passed Light review.',
    findings: [],
  }));
  assert.equal(next.lightReview.event.headSha, NEXT_HEAD);
  assert.equal(next.lightReview.decision.action, 'quick-passed');
  assert.equal(next.reviewJob.headSha, NEXT_HEAD);
  assert.equal(next.metadata.stage, 'full');
  assert.equal(next.metadata.headSha, NEXT_HEAD);
  assert.match(reviewWorkerPath(root, next.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 1);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(loadIssueLifecycle(root, 101), []);
});

test('an imported quick head advance before the first Light review stays staged', async (t) => {
  const { root, managed, pr } = fixture(t);
  stagedReviewConfig(root);
  pr.headRefOid = NEXT_HEAD;

  const reconciled = reconcileManagedPullRequest(root, managed.id, {
    now: 3000,
    snapshot: pr,
    effectRunner: () => [],
  });
  assert.equal(reconciled.headChanged, true);
  assert.equal(reconciled.stagedReviewQueued, true);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].currentHeadSha, NEXT_HEAD);

  const next = await reviewNow(root, pr, () => ({
    result: 'pass',
    summary: 'The first Light review passed on the current head.',
    findings: [],
  }));
  assert.equal(next.reviewJob.headSha, NEXT_HEAD);
  assert.equal(next.metadata.stage, 'full');
  assert.match(reviewWorkerPath(root, next.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(loadRun(root, 101), null);
  assert.deepEqual(loadIssueLifecycle(root, 101), []);
});

test('a repaired imported Light head returns to staged Light before Full review', async (t) => {
  const { root, managed, pr } = fixture(t);
  stagedReviewConfig(root);

  const first = await reviewNow(root, pr, () => ({
    result: 'changes',
    summary: 'Repair is required.',
    findings: [{ severity: 'blocking', message: 'Repair the imported head.' }],
  }));
  assert.equal(first.lightReview.decision.action, 'repair');

  const repairedPr = { ...pr, headRefOid: 'fedcba9876543210fedcba9876543210fedcba98' };
  let effects = [];
  const reconciled = reconcileManagedPullRequest(root, managed.id, {
    now: 3000,
    snapshot: repairedPr,
    effectRunner(_root, _managedId, nextEffects) {
      effects = nextEffects;
      return [];
    },
  });
  assert.equal(reconciled.headChanged, true);
  assert.equal(reconciled.review, null);
  assert.equal(reconciled.stagedReviewQueued, true);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 0);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].reviewState, 'queued');
  assert.deepEqual(effects, [{
    type: 'set-review-labels',
    pullRequestNumber: 45,
    add: ['paseo:review-queued'],
    remove: ['paseo:reviewing', 'paseo:changes-requested', 'paseo:fixing', 'paseo:review-failed'],
  }]);

  const next = await reviewNow(root, repairedPr, () => ({
    result: 'pass',
    summary: 'The repaired Light head passed.',
    findings: [],
  }));
  assert.equal(next.lightReview.decision.action, 'quick-passed');
  assert.equal(next.reviewJob.headSha, repairedPr.headRefOid);
  assert.equal(next.metadata.stage, 'full');
  assert.match(next.reviewJob.id, /^review-/);
  assert.match(reviewWorkerPath(root, next.reviewJob.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 1);
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].workspaceId, null);
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
