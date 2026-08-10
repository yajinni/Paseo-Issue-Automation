import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureManagedApprovedFinalization,
  finalizeApprovedPullRequest,
} from '../src/approved-pr-finalization.mjs';
import {
  enterConfiguredQuickHandoff,
  markReviewNeedsAttention,
  runConfiguredHarnessReview,
} from '../src/controller-review-workflow.mjs';
import { PASEO_LABELS } from '../src/label-catalog.mjs';
import { markIssueMerged } from '../src/issue-merge-state.mjs';
import { saveValidatedPrAutomationConfig } from '../src/pr-review-config.mjs';
import {
  enqueueReviewInStore,
  registerManagedPullRequest,
} from '../src/pr-review-queue.mjs';
import {
  applyMergedIssueEffect,
  reconcileManagedPullRequest,
  recoverPrReviewState,
} from '../src/pr-review-reconcile.mjs';
import {
  PR_REVIEW_LABELS,
  loadPrReviewStore,
  mutatePrReviewStore,
  transitionManaged,
} from '../src/pr-review-store.mjs';
import { REVIEW_WORKFLOW_PROMPT_VERSION } from '../src/review-workflow-prompts.mjs';
import { loadRun, saveConfig, saveRun } from '../src/state.mjs';
import {
  enforceWebChatGptFullReviewLimits,
} from '../src/web-chatgpt-full-review-reconcile.mjs';
import {
  recordWebChatGptFullReviewMetadata,
  webChatGptFullReviewMetadata,
} from '../src/web-chatgpt-full-review.mjs';

const HEAD = 'abcdef1234567890';
const NEXT_HEAD = 'fedcba0987654321';
const REPOSITORY = 'octo/app';
const ISSUE = 7;
const PR = 11;
const BRANCH = 'ai/issue-7-release-matrix';

function repository(t, prefix = 'paseo-release-matrix-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function reviewConfig(workflow, overrides = {}) {
  return {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 60,
    maxActive: 1,
    codingHarness: 'fixture',
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 0 },
    review: {
      workflow,
      quickMaxRounds: 2,
      fullMaxRounds: 2,
      autoMergeApproved: false,
      ...overrides,
    },
    models: {
      orchestrator: 'fixture/coder',
      coder: 'fixture/coder',
      coderThinking: 'medium',
      reviewer: 'fixture/reviewer',
      reviewerThinking: 'high',
    },
  };
}

function seedRun(root, overrides = {}) {
  return saveRun(root, ISSUE, {
    issueNumber: ISSUE,
    issueTitle: 'Release acceptance matrix',
    issueUrl: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
    status: 'agent-running',
    phase: 'coding',
    branch: BRANCH,
    attempt: 1,
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    prNumber: PR,
    prUrl: `https://example.invalid/${REPOSITORY}/pull/${PR}`,
    events: [{ event: 'validation-summary', result: 'PASS', commit: HEAD, details: 'Exact-head validation passed.' }],
    activity: [],
    ...overrides,
  });
}

function snapshot(root, overrides = {}) {
  const state = loadRun(root, ISSUE);
  return {
    state,
    head: HEAD,
    pr: {
      number: PR,
      url: `https://example.invalid/${REPOSITORY}/pull/${PR}`,
      state: 'OPEN',
      isDraft: false,
      headRefOid: HEAD,
      headRefName: BRANCH,
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
      ...overrides,
    },
  };
}

function exactVerdict(stage, round, result = 'pass', headSha = HEAD) {
  return {
    repository: REPOSITORY,
    pullRequestNumber: PR,
    issueNumber: ISSUE,
    headSha,
    stage,
    round,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
    result,
    summary: result === 'changes' ? 'Fix the release acceptance edge case.' : 'The exact head is approved.',
    findings: result === 'changes'
      ? [{
        severity: 'blocking',
        message: 'Fix the release acceptance edge case.',
        file: 'src/release-fixture.mjs',
        line: 7,
        requiredChange: 'Apply the requested repair before approval.',
      }]
      : [],
  };
}

function jsonRunner(currentHead = HEAD) {
  return (command, args) => {
    assert.equal(command, 'gh');
    if (args[0] === 'repo') return { nameWithOwner: REPOSITORY };
    if (args[0] === 'issue') return {
      number: ISSUE,
      title: 'Release acceptance matrix',
      body: '## Acceptance criteria\n- Exercise the production review path.',
      url: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
      comments: [],
      blockedBy: { nodes: [] },
      blocking: { nodes: [] },
    };
    if (args[0] === 'pr') return {
      number: PR,
      state: 'OPEN',
      isDraft: false,
      headRefOid: currentHead,
      headRefName: BRANCH,
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
      url: `https://example.invalid/${REPOSITORY}/pull/${PR}`,
    };
    throw new Error(`Unexpected gh JSON call: ${args.join(' ')}`);
  };
}

function successfulRunner(calls = []) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { ok: true, stdout: '', stderr: '' };
  };
}

function saveWebConfiguration(root, fullMaxRounds = 3) {
  saveConfig(root, reviewConfig('quick-web-chatgpt', { fullMaxRounds }));
  saveValidatedPrAutomationConfig(root, {
    enabled: true,
    browserReview: {
      enabled: true,
      projectConversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
      reviewPromptVersion: 1,
      reviewDebounceMs: 0,
      maxSubmissionAttempts: 3,
    },
    reviewQueue: { paused: false },
    reconciliation: { enabled: true, activeIntervalMs: 45000, idleIntervalMs: 300000 },
    githubActions: { allowChatGPTMerge: false, verifyIssueClosure: true },
  });
}

function registerWebPr(root) {
  return registerManagedPullRequest(root, {
    repository: REPOSITORY,
    issueNumber: ISSUE,
    issueUrl: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
    pullRequestNumber: PR,
    pullRequestUrl: `https://example.invalid/${REPOSITORY}/pull/${PR}`,
    branchName: BRANCH,
    worktreePath: root,
    workspaceId: 'workspace-7',
    coderAgentId: 'coder-7',
    currentHeadSha: HEAD,
  });
}

function reviewMarker(job, result, humanMarkdown = '') {
  const metadata = {
    reviewRequestId: job.reviewRequestId,
    repository: REPOSITORY,
    pullRequestNumber: PR,
    issueNumber: ISSUE,
    headSha: job.headSha,
    reviewRound: job.reviewRound,
    stage: 'full',
    round: webChatGptFullReviewMetadata(job.root || '', job.id)?.stageRound || job.reviewRound,
    promptVersion: job.promptVersion,
    result,
  };
  return `<!-- paseo-review:v1 ${JSON.stringify(metadata)} -->\n${humanMarkdown}`;
}

function installFakeGh(t, root) {
  if (process.platform === 'win32') return;
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = path.join(bin, 'gh');
  writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'label' && args[1] === 'list') { process.stdout.write('[]'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'view') { process.stdout.write(JSON.stringify({number:${PR},url:'https://example.invalid/${REPOSITORY}/pull/${PR}',state:'OPEN',isDraft:false,headRefOid:'${HEAD}',headRefName:'${BRANCH}',baseRefName:'main',mergedAt:null,closedAt:null,labels:[],reviewDecision:'',comments:[],reviews:[],statusCheckRollup:[{name:'CI',conclusion:'SUCCESS'}],body:'Closes #${ISSUE}',closingIssuesReferences:[{number:${ISSUE}}]})); process.exit(0); }
process.exit(0);
`, { mode: 0o755 });
  chmodSync(script, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous || ''}`;
  t.after(() => { process.env.PATH = previous; });
}

test('release matrix: full-immediate pass reaches deterministic human finalization when auto-merge is disabled', (t) => {
  const root = repository(t);
  const config = reviewConfig('full-immediate');
  seedRun(root);
  const review = runConfiguredHarnessReview(root, ISSUE, snapshot(root), {
    config,
    jsonRunner: jsonRunner(),
    agentRunner: () => exactVerdict('full', 1, 'pass'),
    auditRunner: successfulRunner(),
  });
  assert.equal(review.decision.action, 'full-passed');
  const result = finalizeApprovedPullRequest(root, {
    repository: REPOSITORY,
    issueNumber: ISSUE,
    issueUrl: review.issue.url,
    pullRequest: snapshot(root).pr,
    state: loadRun(root, ISSUE),
    approvalSource: 'harness-review',
  }, {
    config,
    humanFinalizer() {
      return saveRun(root, ISSUE, { ...loadRun(root, ISSUE), phase: 'human-review', status: 'human-review', approvedCommit: HEAD });
    },
  });
  assert.equal(result.mode, 'human-review');
  assert.equal(loadRun(root, ISSUE).approvedCommit, HEAD);
});

test('release matrix: full review exhaustion becomes Needs Attention through the controller boundary', (t) => {
  const root = repository(t);
  const config = reviewConfig('full-immediate', { fullMaxRounds: 2 });
  seedRun(root, {
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD, details: 'validated' },
      { event: 'harness-review', stage: 'full', round: 1, result: 'changes', headSha: HEAD, findings: [{ severity: 'blocking', message: 'first' }] },
    ],
  });
  const review = runConfiguredHarnessReview(root, ISSUE, snapshot(root), {
    config,
    jsonRunner: jsonRunner(),
    agentRunner: () => exactVerdict('full', 2, 'changes'),
    auditRunner: successfulRunner(),
  });
  assert.equal(review.decision.action, 'attention');
  const calls = [];
  const state = markReviewNeedsAttention(root, ISSUE, snapshot(root), review, { runner: successfulRunner(calls) });
  assert.equal(state.phase, 'review-attention');
  assert.equal(state.status, PASEO_LABELS.needsAttention);
  assert.equal(calls.some((call) => call.args.includes(PASEO_LABELS.needsAttention)), true);
});

test('release matrix: quick pass and quick exhaustion both enter Manual, preserving unresolved exhaustion findings as context', (t) => {
  for (const mode of ['pass', 'exhausted']) {
    const root = repository(t, `paseo-release-manual-${mode}-`);
    const config = reviewConfig('quick-manual', { quickMaxRounds: 1 });
    seedRun(root);
    const review = runConfiguredHarnessReview(root, ISSUE, snapshot(root), {
      config,
      jsonRunner: jsonRunner(),
      agentRunner: () => exactVerdict('quick', 1, mode === 'pass' ? 'pass' : 'changes'),
      auditRunner: successfulRunner(),
    });
    assert.equal(review.decision.action, mode === 'pass' ? 'quick-passed' : 'handoff');
    const calls = [];
    const handoff = enterConfiguredQuickHandoff(root, ISSUE, snapshot(root), review, { config, runner: successfulRunner(calls) });
    assert.equal(handoff.target, 'manual');
    assert.equal(loadRun(root, ISSUE).reviewRuntimeStage, 'full-manual');
    if (mode === 'exhausted') {
      const comment = calls.find((call) => call.args[0] === 'pr' && call.args[1] === 'comment');
      assert.ok(comment);
      assert.match(comment.args.at(-1), /Fix the release acceptance edge case/);
    }
  }
});

test('release matrix: quick pass and exhaustion route to staged Web ChatGPT with full-stage metadata pre-seeded', { skip: process.platform === 'win32' }, (t) => {
  for (const mode of ['pass', 'exhausted']) {
    const root = repository(t, `paseo-release-web-${mode}-`);
    installFakeGh(t, root);
    const config = reviewConfig('quick-web-chatgpt', { quickMaxRounds: 1, fullMaxRounds: 3 });
    saveConfig(root, config);
    saveValidatedPrAutomationConfig(root, {
      enabled: true,
      browserReview: { enabled: true, projectConversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc', reviewPromptVersion: 1, reviewDebounceMs: 0, maxSubmissionAttempts: 3 },
      reviewQueue: { paused: false },
    });
    seedRun(root);
    const review = runConfiguredHarnessReview(root, ISSUE, snapshot(root), {
      config,
      jsonRunner: jsonRunner(),
      agentRunner: () => exactVerdict('quick', 1, mode === 'pass' ? 'pass' : 'changes'),
      auditRunner: successfulRunner(),
    });
    const handoff = enterConfiguredQuickHandoff(root, ISSUE, snapshot(root), review, { config });
    assert.equal(handoff.target, 'web-chatgpt');
    const metadata = webChatGptFullReviewMetadata(root, handoff.reviewJob.id);
    assert.equal(metadata.stage, 'full');
    assert.equal(metadata.stageRound, 1);
    assert.equal(metadata.maxStageRounds, 3);
    assert.equal(loadRun(root, ISSUE).reviewRuntimeStage, 'full-web-chatgpt');
    if (mode === 'exhausted') assert.equal(metadata.quickFindings.length, 1);
  }
});

test('release matrix: stale harness approval is rejected before it can authorize the current head', (t) => {
  const root = repository(t);
  const config = reviewConfig('full-immediate');
  seedRun(root);
  const review = runConfiguredHarnessReview(root, ISSUE, snapshot(root), {
    config,
    jsonRunner: jsonRunner(NEXT_HEAD),
    agentRunner: () => exactVerdict('full', 1, 'pass'),
    auditRunner: successfulRunner(),
  });
  assert.equal(review.decision.action, 'stale');
  assert.equal(review.event.result, 'stale');
  assert.equal(loadRun(root, ISSUE).events.at(-1).result, 'stale');
});

test('release matrix: Web ChatGPT changes create the existing fix job and the repaired head receives a fresh full-review round', (t) => {
  const root = repository(t);
  saveWebConfiguration(root, 3);
  seedRun(root);
  const registered = registerWebPr(root);
  const job = registered.reviewJob;
  recordWebChatGptFullReviewMetadata(root, job.id, { stageRound: 1, maxStageRounds: 3, quickFindings: [] });
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests.find((item) => item.id === registered.managed.id);
    const active = store.reviewJobs.find((item) => item.id === job.id);
    active.state = 'awaiting_result';
    managed.reviewState = 'awaiting_result';
    managed.activeReviewRequestId = active.reviewRequestId;
  });
  const marker = `<!-- paseo-review:v1 ${JSON.stringify({
    reviewRequestId: job.reviewRequestId,
    repository: REPOSITORY,
    pullRequestNumber: PR,
    issueNumber: ISSUE,
    headSha: HEAD,
    reviewRound: job.reviewRound,
    stage: 'full',
    round: 1,
    promptVersion: job.promptVersion,
    result: 'changes_requested',
  })} -->\nFix the release acceptance edge case.`;
  const outcome = reconcileManagedPullRequest(root, registered.managed.id, {
    snapshot: {
      number: PR,
      state: 'OPEN',
      headRefOid: HEAD,
      labels: [{ name: PR_REVIEW_LABELS.changesRequested }],
      comments: [{ id: 1, body: marker, createdAt: '2026-08-10T12:00:00Z' }],
      reviews: [],
    },
    effectRunner: () => [],
  });
  assert.equal(outcome.review.result, 'changes_requested');
  let store = loadPrReviewStore(root);
  const fix = store.fixJobs.find((item) => item.managedPullRequestId === registered.managed.id);
  assert.ok(fix);
  assert.equal(fix.state, 'queued');

  mutatePrReviewStore(root, (next) => {
    const managed = next.managedPullRequests.find((item) => item.id === registered.managed.id);
    const fixJob = next.fixJobs.find((item) => item.id === fix.id);
    fixJob.state = 'completed';
    fixJob.newHeadSha = NEXT_HEAD;
    fixJob.completedAt = new Date().toISOString();
    enqueueReviewInStore(next, managed, { headSha: NEXT_HEAD, immediate: true });
  });
  const carried = enforceWebChatGptFullReviewLimits(root, { applyLabels: () => {} });
  assert.equal(carried.carried.length, 1);
  store = loadPrReviewStore(root);
  const fresh = store.reviewJobs.find((item) => item.headSha === NEXT_HEAD && item.state === 'queued');
  assert.ok(fresh);
  const metadata = webChatGptFullReviewMetadata(root, fresh.id);
  assert.equal(metadata.stageRound, 2);
  assert.equal(metadata.maxStageRounds, 3);
  assert.equal(store.managedPullRequests.find((item) => item.id === registered.managed.id).currentHeadSha, NEXT_HEAD);
});

test('release matrix: full Web review exhaustion cancels automatic repair and requires attention', (t) => {
  const root = repository(t);
  saveWebConfiguration(root, 2);
  seedRun(root);
  const registered = registerWebPr(root);
  const job = registered.reviewJob;
  recordWebChatGptFullReviewMetadata(root, job.id, { stageRound: 2, maxStageRounds: 2, quickFindings: [] });
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests.find((item) => item.id === registered.managed.id);
    managed.reviewState = 'fix_queued';
    store.fixJobs.push({
      id: 'release-fix-limit',
      managedPullRequestId: managed.id,
      reviewJobId: job.id,
      reviewRequestId: job.reviewRequestId,
      repository: REPOSITORY,
      pullRequestNumber: PR,
      issueNumber: ISSUE,
      branchName: BRANCH,
      reviewedHeadSha: HEAD,
      findings: 'Still broken.',
      state: 'queued',
      priority: 0,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  const labels = [];
  const result = enforceWebChatGptFullReviewLimits(root, { applyLabels: (_root, managed) => labels.push(managed.issueNumber) });
  assert.equal(result.stopped.length, 1);
  const store = loadPrReviewStore(root);
  assert.equal(store.fixJobs.find((item) => item.id === 'release-fix-limit').state, 'cancelled');
  assert.equal(store.managedPullRequests.find((item) => item.id === registered.managed.id).reviewState, 'failed');
  assert.deepEqual(labels, [ISSUE]);
});

test('release matrix: auto-merge enabled requests only the guarded local merge path', (t) => {
  const root = repository(t);
  const config = reviewConfig('full-immediate', { autoMergeApproved: true });
  seedRun(root, {
    phase: 'reviewing-heavy',
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD },
      { event: 'harness-review', stage: 'full', round: 1, result: 'pass', headSha: HEAD, findings: [] },
    ],
  });
  let mergeRequests = 0;
  const result = finalizeApprovedPullRequest(root, {
    repository: REPOSITORY,
    issueNumber: ISSUE,
    issueUrl: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
    pullRequest: snapshot(root).pr,
    state: loadRun(root, ISSUE),
    approvalSource: 'harness-review',
  }, {
    config,
    runner(command, args) {
      if (command === 'gh' && args[0] === 'api') return { ok: true, stdout: 'true\n', stderr: '' };
      if (command === 'gh' && args[0] === 'issue' && args[1] === 'edit') return { ok: true, stdout: '', stderr: '' };
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    autoMergeRequester(_root, context) {
      mergeRequests += 1;
      assert.equal(context.pullRequest.headSha, HEAD);
      assert.equal(context.review.approvedHeadSha, HEAD);
      assert.equal(context.validation.headSha, HEAD);
      assert.equal(context.paseoOwned, true);
      return { requested: true, enabled: true, reason: null };
    },
  });
  assert.equal(result.mode, 'auto-merge');
  assert.equal(result.enabled, true);
  assert.equal(mergeRequests, 1);
  assert.equal(loadRun(root, ISSUE).phase, 'auto-merge-requested');
});

test('release matrix: merged PR closes and verifies only the explicitly associated issue before Completed', (t) => {
  const root = repository(t);
  seedRun(root, {
    phase: 'auto-merge-requested',
    approvedCommit: HEAD,
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD },
      { event: 'review', result: 'APPROVED', commit: HEAD, source: 'harness-review-compat' },
    ],
  });
  const managed = ensureManagedApprovedFinalization(root, {
    repository: REPOSITORY,
    issueNumber: ISSUE,
    issueUrl: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
    pullRequest: snapshot(root).pr,
    state: loadRun(root, ISSUE),
    headSha: HEAD,
    approvalSource: 'harness-review',
  });
  let closed = false;
  const closedIssues = [];
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    snapshot: {
      number: PR,
      state: 'MERGED',
      mergedAt: '2026-08-10T12:30:00Z',
      headRefOid: HEAD,
      body: `Closes #${ISSUE}`,
      closingIssuesReferences: [{ number: ISSUE }],
      labels: [],
      comments: [],
      reviews: [],
    },
    effectRunner(effectRoot, _managedId, effects) {
      return effects.map((effect) => {
        if (effect.type !== 'verify-merged-issue') return { cleared: true };
        return applyMergedIssueEffect(effectRoot, effect, {
          issueReader: () => ({ number: ISSUE, state: closed ? 'CLOSED' : 'OPEN' }),
          issueCloser: (_root, issueNumber) => { closedIssues.push(issueNumber); closed = true; },
          lifecycleCompleter: (lifecycleRoot, lifecycleEffect) => markIssueMerged(lifecycleRoot, lifecycleEffect),
        });
      });
    },
  });
  assert.equal(outcome.state, 'merged');
  assert.equal(outcome.reviewVerified, true);
  assert.deepEqual(closedIssues, [ISSUE]);
  const state = loadRun(root, ISSUE);
  assert.equal(state.phase, 'completed');
  assert.equal(state.mergedHeadSha, HEAD);
  assert.equal(state.prNumber, PR);
});

test('release matrix: closed-unmerged becomes operator attention and never completion', (t) => {
  const root = repository(t);
  seedRun(root, {
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD },
      { event: 'review', result: 'APPROVED', commit: HEAD, source: 'harness-review-compat' },
    ],
  });
  const managed = ensureManagedApprovedFinalization(root, {
    repository: REPOSITORY,
    issueNumber: ISSUE,
    issueUrl: `https://example.invalid/${REPOSITORY}/issues/${ISSUE}`,
    pullRequest: snapshot(root).pr,
    state: loadRun(root, ISSUE),
    headSha: HEAD,
    approvalSource: 'harness-review',
  });
  const outcome = reconcileManagedPullRequest(root, managed.id, {
    snapshot: { number: PR, state: 'CLOSED', mergedAt: null, headRefOid: HEAD, labels: [], comments: [], reviews: [] },
    effectRunner: () => [],
  });
  assert.equal(outcome.state, 'closed_unmerged');
  assert.equal(outcome.needsOperator, true);
  const store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests.find((item) => item.id === managed.id).reviewState, 'closed_unmerged');
  assert.notEqual(loadRun(root, ISSUE).phase, 'completed');
});

test('release matrix: startup recovery makes in-flight review and fix work recoverable without duplicating jobs', { skip: process.platform === 'win32' }, (t) => {
  const root = repository(t);
  installFakeGh(t, root);
  saveWebConfiguration(root, 3);
  seedRun(root);
  const registered = registerWebPr(root);
  mutatePrReviewStore(root, (store) => {
    const managed = store.managedPullRequests.find((item) => item.id === registered.managed.id);
    const review = store.reviewJobs.find((item) => item.id === registered.reviewJob.id);
    review.state = 'submitting';
    store.runtime.activeReviewJobId = review.id;
    managed.reviewState = 'submitting';
    store.fixJobs.push({
      id: 'release-recovery-fix',
      managedPullRequestId: managed.id,
      reviewJobId: review.id,
      reviewRequestId: `${review.reviewRequestId}:fix`,
      repository: REPOSITORY,
      pullRequestNumber: PR,
      issueNumber: ISSUE,
      branchName: BRANCH,
      reviewedHeadSha: HEAD,
      findings: 'Recover me.',
      state: 'fixing',
      priority: 0,
      attempts: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  const before = loadPrReviewStore(root);
  assert.equal(before.reviewJobs.length, 1);
  assert.equal(before.fixJobs.length, 1);
  recoverPrReviewState(root, { effectRunner: () => [] });
  const after = loadPrReviewStore(root);
  assert.equal(after.reviewJobs.length, 1);
  assert.equal(after.fixJobs.length, 1);
  assert.equal(after.reviewJobs[0].state, 'queued');
  assert.equal(after.fixJobs[0].state, 'interrupted');
  assert.equal(after.runtime.activeReviewJobId, null);
});
