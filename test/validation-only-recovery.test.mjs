import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completeFixJob, validateFixedHead } from '../src/fix-worker.mjs';
import { evaluateApprovedReviewGate } from '../src/pr-review-finalize.mjs';
import { createFixJobInStore, enqueueReviewInStore, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import {
  findManaged,
  loadPrReviewStore,
  mutatePrReviewStore,
  savePrAutomationConfig,
} from '../src/pr-review-store.mjs';

const HEAD = 'abcdef1234567890';
const VALIDATION_REASON = `No passing validation-summary event exists for the reviewed commit ${HEAD}.`;

function successfulGateRunner(_command, args, options) {
  if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
  if (args[0] === 'merge-base') return { ok: true, stdout: '', stderr: '' };
  if (args[0] === 'rev-parse' && options?.cwd === '/managed-worktree') {
    return { ok: true, stdout: `${HEAD}\n`, stderr: '' };
  }
  if (args[0] === 'status' && options?.cwd === '/managed-worktree') {
    return { ok: true, stdout: '', stderr: '' };
  }
  throw new Error(`Unexpected git call: ${args.join(' ')}`);
}

const gateManaged = {
  issueNumber: 12,
  pullRequestNumber: 34,
  currentHeadSha: HEAD,
  branchName: 'ai/issue-12-test',
  worktreePath: '/managed-worktree',
};
const gateJob = { headSha: HEAD, reviewRequestId: 'request-1' };
const gatePr = {
  state: 'OPEN',
  headRefOid: HEAD,
  headRefName: gateManaged.branchName,
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS' }],
};

test('deterministic approval gate recovers missing controller validation only after exact clean-head verification', () => {
  let recorded = null;
  const result = evaluateApprovedReviewGate('/repo', gateManaged, gateJob, gatePr, {
    runner: successfulGateRunner,
    config: { baseBranch: 'main' },
    runState: { issueNumber: 12, events: [] },
    recordValidation(_root, issueNumber, event) {
      recorded = { issueNumber, event };
      return { issueNumber, events: [event] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.validationRecovered, true);
  assert.equal(result.validation.commit, HEAD);
  assert.equal(recorded.issueNumber, 12);
  assert.equal(recorded.event.result, 'PASS');
  assert.equal(recorded.event.commit, HEAD);
});

test('controller validation recovery fails closed for dirty worktrees and stale base before recording PASS', () => {
  let recorded = false;
  const dirty = evaluateApprovedReviewGate('/repo', gateManaged, gateJob, gatePr, {
    runner(command, args, options) {
      if (args[0] === 'status' && options?.cwd === '/managed-worktree') {
        return { ok: true, stdout: ' M src/a.mjs\n', stderr: '' };
      }
      return successfulGateRunner(command, args, options);
    },
    config: { baseBranch: 'main' },
    runState: { issueNumber: 12, events: [] },
    recordValidation() {
      recorded = true;
      return { events: [] };
    },
  });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.repair, true);
  assert.equal(dirty.validationMissing, true);
  assert.match(dirty.reason, /not clean/i);
  assert.equal(recorded, false);

  const staleBase = evaluateApprovedReviewGate('/repo', gateManaged, gateJob, gatePr, {
    runner(_command, args) {
      if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
      if (args[0] === 'merge-base') return { ok: false, stdout: '', stderr: '' };
      throw new Error(`Validation must not run after stale-base detection: ${args.join(' ')}`);
    },
    config: { baseBranch: 'main' },
    runState: { issueNumber: 12, events: [] },
    recordValidation() {
      recorded = true;
      return { events: [] };
    },
  });
  assert.equal(staleBase.ok, false);
  assert.equal(staleBase.repair, true);
  assert.match(staleBase.reason, /latest main/);
  assert.equal(recorded, false);
});

test('validation-only repair may validate the unchanged exact head but ordinary repair still requires a new head', () => {
  const managed = {
    issueNumber: 12,
    pullRequestNumber: 34,
    branchName: 'ai/issue-12-test',
    worktreePath: '/managed-worktree',
  };
  const pr = {
    state: 'OPEN',
    headRefOid: HEAD,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
  };
  const runner = (_command, args, options) => {
    if (args[0] === 'rev-parse') return { ok: true, stdout: `${HEAD}\n`, stderr: '' };
    if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'merge-base') return { ok: true, stdout: '', stderr: '' };
    throw new Error(`Unexpected git call from ${options?.cwd || ''}: ${args.join(' ')}`);
  };
  const validationJob = { reviewedHeadSha: HEAD, findings: VALIDATION_REASON };
  const recovered = validateFixedHead('/repo', managed, validationJob, pr, {
    config: { baseBranch: 'main' },
    runState: { issueNumber: 12, events: [] },
    runner,
    recordValidation(_root, _issueNumber, event) {
      return { events: [event] };
    },
  });
  assert.equal(recovered.newHeadSha, HEAD);
  assert.equal(recovered.validationOnlyRecovery, true);
  assert.equal(recovered.validation.commit, HEAD);

  assert.throws(() => validateFixedHead('/repo', managed, {
    reviewedHeadSha: HEAD,
    findings: 'Fix a real defect.',
  }, pr, {
    config: { baseBranch: 'main' },
    runState: { events: [] },
    runner,
  }), /without pushing a new PR head/);
});

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-validation-only-fix-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true, reviewDebounceMs: 0 },
  });
  return root;
}

test('existing validation-only fix job resumes the prior exact-head approval without a no-op commit or review-round increment', (t) => {
  const root = repo(t);
  const registered = registerManagedPullRequest(root, {
    repository: 'owner/repo',
    issueNumber: 288,
    issueUrl: 'https://github.com/owner/repo/issues/288',
    pullRequestNumber: 289,
    pullRequestUrl: 'https://github.com/owner/repo/pull/289',
    branchName: 'ai/issue-288-canary',
    workspaceId: 'workspace-288',
    worktreePath: '/managed-worktree',
    currentHeadSha: HEAD,
  }, { now: 1000 });

  let fixJobId;
  mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, registered.managed.id);
    const reviewJob = enqueueReviewInStore(store, managed, {
      headSha: HEAD,
      immediate: true,
      now: 1500,
    });
    reviewJob.state = 'awaiting_result';
    const fix = createFixJobInStore(store, managed, reviewJob, VALIDATION_REASON, {
      sourceCommentId: 77,
      reviewResult: 'approved',
      now: 2000,
    });
    fix.state = 'fixing';
    fix.coderAgentId = 'coder-288';
    fixJobId = fix.id;
  });

  let recordedReview = null;
  let labels = null;
  const result = completeFixJob(root, fixJobId, {
    waitForAgent: false,
    snapshot: {
      state: 'OPEN',
      headRefOid: HEAD,
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS' }],
    },
    validator: () => ({
      newHeadSha: HEAD,
      validation: { event: 'validation-summary', result: 'PASS', commit: HEAD },
      validationOnlyRecovery: true,
    }),
    gateEvaluator(_root, managed, reviewJob) {
      assert.equal(managed.currentHeadSha, HEAD);
      assert.equal(reviewJob.headSha, HEAD);
      assert.equal(reviewJob.result, 'approved');
      return { ok: true, commit: HEAD };
    },
    reviewRecorder(_root, managed, reviewJob) {
      recordedReview = { managedId: managed.id, reviewRequestId: reviewJob.reviewRequestId };
      return {};
    },
    labelWriter(_root, pullRequestNumber, update) {
      labels = { pullRequestNumber, update };
      return { changed: true };
    },
  });

  const store = loadPrReviewStore(root);
  const managed = store.managedPullRequests[0];
  assert.equal(result.validationOnlyRecovery, true);
  assert.equal(result.newHeadSha, HEAD);
  assert.equal(result.reviewRound, 1);
  assert.equal(managed.reviewRound, 1);
  assert.equal(managed.reviewState, 'ready_to_merge');
  assert.equal(managed.currentHeadSha, HEAD);
  assert.equal(store.fixJobs[0].state, 'completed');
  assert.equal(store.fixJobs[0].newHeadSha, HEAD);
  assert.equal(store.reviewJobs.length, 1);
  assert.equal(store.reviewJobs[0].state, 'completed');
  assert.equal(store.reviewJobs[0].result, 'approved');
  assert.equal(recordedReview.managedId, managed.id);
  assert.equal(recordedReview.reviewRequestId, store.reviewJobs[0].reviewRequestId);
  assert.equal(labels.pullRequestNumber, 289);
  assert.ok(labels.update.remove.includes('paseo:failed'));
  assert.equal(labels.update.add, undefined);
});
