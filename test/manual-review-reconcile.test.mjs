import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completeFixJob } from '../src/fix-worker.mjs';
import {
  reconcileManualReview,
  registerManualReviewPullRequest,
} from '../src/manual-review-reconcile.mjs';
import {
  findManaged,
  loadPrReviewStore,
  mutatePrReviewStore,
} from '../src/pr-review-store.mjs';
import { DEFAULT_CONFIG, loadRun, saveConfig, saveRun } from '../src/state.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-manual-review-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  saveConfig(root, { ...DEFAULT_CONFIG, baseBranch: 'main' });
  const bin = path.join(root, 'bin');
  const callsFile = path.join(root, 'gh-calls.log');
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  writeFileSync(gh, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: 11,
    isDraft: false,
    headRefOid: 'abcdef1234567890',
    baseRefName: 'main',
    statusCheckRollup: [],
    url: 'https://example.invalid/octo/app/pull/11',
  }));
}
process.exit(0);
`);
  chmodSync(gh, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  t.after(() => {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function ghCalls(root) {
  const file = path.join(root, 'gh-calls.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function saveManualRun(root, headSha = 'abcdef1234567890') {
  return saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Manual review fixture',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'paseo:review-queued',
    phase: 'manual-review',
    reviewRuntimeStage: 'full-manual',
    reviewExpectedHeadSha: headSha,
    branch: 'ai/issue-7-manual-review',
    attempt: 1,
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    prNumber: 11,
    prUrl: 'https://example.invalid/octo/app/pull/11',
    completedAt: null,
    events: [{
      event: 'validation-summary',
      result: 'PASS',
      commit: headSha,
      details: `Validation passed for ${headSha}.`,
      at: '2026-08-10T04:00:00Z',
    }],
    activity: [],
  });
}

function register(root, headSha = 'abcdef1234567890') {
  return registerManualReviewPullRequest(root, {
    repository: 'octo/app',
    issueNumber: 7,
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    pullRequestNumber: 11,
    pullRequestUrl: 'https://example.invalid/octo/app/pull/11',
    branchName: 'ai/issue-7-manual-review',
    worktreePath: root,
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    currentHeadSha: headSha,
    reviewRound: 1,
  });
}

function manualChangesSnapshot(headSha = 'abcdef1234567890') {
  return {
    number: 11,
    state: 'OPEN',
    isDraft: false,
    headRefOid: headSha,
    reviews: [{
      id: 9001,
      state: 'CHANGES_REQUESTED',
      commitId: headSha,
      submittedAt: '2026-08-10T04:05:00Z',
      body: 'Fix the null-state regression and add a regression test.',
    }],
  };
}

function manualApprovedSnapshot(headSha = 'abcdef1234567890') {
  return {
    number: 11,
    state: 'OPEN',
    isDraft: false,
    headRefOid: headSha,
    reviews: [{
      id: 9003,
      state: 'APPROVED',
      commitId: headSha,
      submittedAt: '2026-08-10T04:06:00Z',
      body: 'Approved.',
    }],
  };
}

function manualMergedSnapshot(headSha = 'abcdef1234567890') {
  return {
    number: 11,
    state: 'MERGED',
    isDraft: false,
    headRefOid: headSha,
    mergedAt: '2026-08-10T04:10:00Z',
    reviews: [],
  };
}

function manualStaleSnapshot(headSha = 'fedcba9876543210') {
  return {
    number: 11,
    state: 'OPEN',
    isDraft: false,
    headRefOid: headSha,
    reviews: [],
  };
}

test('manual review registration is durable but never creates a browser review job', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const store = loadPrReviewStore(root);
  assert.equal(managed.reviewState, 'paused');
  assert.match(managed.activeReviewRequestId, /^manual-review:/);
  assert.equal(store.reviewJobs.length, 0);
  assert.equal(store.fixJobs.length, 0);
});

test('manual CHANGES_REQUESTED queues one authoritative same-PR fix job', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const outcome = reconcileManualReview(root, managed.id, { snapshot: manualChangesSnapshot() });
  assert.equal(outcome.state, 'fix_queued');
  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.length, 0);
  assert.equal(store.fixJobs.length, 1);
  assert.match(store.fixJobs[0].reviewRequestId, /^manual-review:/);
  assert.equal(store.fixJobs[0].reviewedHeadSha, 'abcdef1234567890');
  assert.match(store.fixJobs[0].findings, /null-state regression/);
  assert.equal(findManaged(store, managed.id).reviewState, 'fix_queued');
  assert.equal(loadRun(root, 7).phase, 'manual-review-fix-queued');
});

test('manual requested changes without authoritative review text fails closed', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  assert.throws(() => reconcileManualReview(root, managed.id, {
    snapshot: {
      ...manualChangesSnapshot(),
      reviews: [{
        id: 9002,
        state: 'CHANGES_REQUESTED',
        commitId: 'abcdef1234567890',
        submittedAt: '2026-08-10T04:05:00Z',
        body: '',
      }],
    },
  }), /authoritative repair handoff/);
  assert.equal(loadPrReviewStore(root).fixJobs.length, 0);
});

test('a completed manual fix returns the validated new head to manual review instead of browser review', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const queued = reconcileManualReview(root, managed.id, { snapshot: manualChangesSnapshot() });
  mutatePrReviewStore(root, (store) => {
    const fix = store.fixJobs.find((job) => job.id === queued.fixJob.id);
    fix.state = 'fixing';
    fix.coderAgentId = 'repair-agent-7';
    const record = findManaged(store, managed.id);
    record.reviewState = 'fixing';
  });

  const result = completeFixJob(root, queued.fixJob.id, {
    waitForAgent: false,
    snapshot: {
      number: 11,
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'fedcba9876543210',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    },
    validator() {
      return {
        newHeadSha: 'fedcba9876543210',
        validation: { details: 'Repaired exact head passed validation.' },
      };
    },
    labelWriter() { return { changed: true }; },
  });

  assert.equal(result.returnToManualReview, true);
  const store = loadPrReviewStore(root);
  assert.equal(store.reviewJobs.length, 0);
  assert.equal(store.fixJobs[0].state, 'completed');
  const nextManaged = findManaged(store, managed.id);
  assert.equal(nextManaged.reviewState, 'paused');
  assert.equal(nextManaged.currentHeadSha, 'fedcba9876543210');
  assert.match(nextManaged.activeReviewRequestId, /fedcba9876543210$/);
  const state = loadRun(root, 7);
  assert.equal(state.phase, 'manual-review');
  assert.equal(state.reviewExpectedHeadSha, 'fedcba9876543210');
  assert.equal(state.completedAt, null);
});

test('repeated manual approval reconciliation does not repeat GitHub side effects', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const approved = manualApprovedSnapshot();

  const first = reconcileManualReview(root, managed.id, { snapshot: approved });
  assert.equal(first.state, 'ready_to_merge');
  assert.equal(first.unchanged, undefined);

  const callsAfterFirst = ghCalls(root);
  assert.equal(callsAfterFirst.filter((args) => args[0] === 'issue' && args[1] === 'comment').length, 1);
  const firstState = loadRun(root, 7);
  assert.equal(firstState.phase, 'human-review');
  assert.equal(firstState.approvedCommit, 'abcdef1234567890');
  assert.equal(firstState.events.filter((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.source === 'manual-review').length, 1);

  const firstStore = loadPrReviewStore(root);
  assert.equal(findManaged(firstStore, managed.id).reviewState, 'ready_to_merge');
  assert.equal(firstStore.history.filter((entry) => entry.entityId === managed.id
    && entry.newState === 'ready_to_merge').length, 1);

  const second = reconcileManualReview(root, managed.id, { snapshot: approved });
  assert.equal(second.state, 'ready_to_merge');
  assert.equal(second.unchanged, true);
  assert.deepEqual(ghCalls(root), callsAfterFirst);

  const secondState = loadRun(root, 7);
  assert.equal(secondState.events.filter((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.source === 'manual-review').length, 1);
  const secondStore = loadPrReviewStore(root);
  assert.equal(secondStore.history.filter((entry) => entry.entityId === managed.id
    && entry.newState === 'ready_to_merge').length, 1);
});

test('repeated merged manual reconciliation records merge observation once', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const merged = manualMergedSnapshot();

  const first = reconcileManualReview(root, managed.id, { snapshot: merged });
  assert.equal(first.state, 'merged-pending-finalization');
  assert.equal(first.unchanged, undefined);
  const firstState = loadRun(root, 7);
  assert.equal(firstState.phase, 'manual-review-merged-pending-finalization');
  assert.equal(firstState.activity.filter((entry) => entry.type === 'manual-review-merge-observed').length, 1);

  const second = reconcileManualReview(root, managed.id, { snapshot: merged });
  assert.equal(second.state, 'merged-pending-finalization');
  assert.equal(second.unchanged, true);
  const secondState = loadRun(root, 7);
  assert.equal(secondState.activity.filter((entry) => entry.type === 'manual-review-merge-observed').length, 1);
});

test('repeated unvalidated manual stale head records operator attention once', (t) => {
  const root = repository(t);
  saveManualRun(root);
  const managed = register(root);
  const stale = manualStaleSnapshot();

  const first = reconcileManualReview(root, managed.id, { snapshot: stale });
  assert.equal(first.state, 'stale');
  assert.equal(first.needsOperator, true);
  assert.equal(first.unchanged, undefined);
  const firstState = loadRun(root, 7);
  assert.equal(firstState.phase, 'manual-review-stale-head');
  assert.equal(firstState.activity.filter((entry) => entry.type === 'manual-review-stale-head').length, 1);

  const second = reconcileManualReview(root, managed.id, { snapshot: stale });
  assert.equal(second.state, 'stale');
  assert.equal(second.needsOperator, true);
  assert.equal(second.unchanged, true);
  const secondState = loadRun(root, 7);
  assert.equal(secondState.activity.filter((entry) => entry.type === 'manual-review-stale-head').length, 1);
});