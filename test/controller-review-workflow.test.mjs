import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  configuredReviewRound,
  configuredReviewStage,
  enterConfiguredQuickHandoff,
  markReviewNeedsAttention,
  runConfiguredHarnessReview,
} from '../src/controller-review-workflow.mjs';
import { reviewWorkerPath } from '../src/pr-review-scheduler.mjs';
import { saveValidatedPrAutomationConfig } from '../src/pr-review-config.mjs';
import { loadPrReviewStore } from '../src/pr-review-store.mjs';
import { loadIssueLifecycle, loadRun, saveRun } from '../src/state.mjs';
import { webChatGptFullReviewMetadata } from '../src/web-chatgpt-full-review.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-controller-review-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function config(workflow = 'quick-manual', quickMaxRounds = 3, fullMaxRounds = 3) {
  return {
    baseBranch: 'main',
    codingHarness: 'fixture',
    review: { workflow, quickMaxRounds, fullMaxRounds, autoMergeApproved: false },
    maxReviewRounds: fullMaxRounds,
    models: { reviewer: 'fixture/reviewer', reviewerThinking: 'high' },
  };
}

function initialRun(root, overrides = {}) {
  return saveRun(root, 7, {
    issueNumber: 7,
    issueTitle: 'Fix review workflow',
    issueUrl: 'https://example.invalid/octo/app/issues/7',
    status: 'agent-running',
    phase: 'coding',
    branch: 'ai/issue-7-fix-review-workflow',
    attempt: 1,
    workspaceId: 'workspace-7',
    worktreePath: path.join(root, 'managed-issue-worktree'),
    coderAgentId: 'coder-7',
    events: [{
      event: 'validation-summary',
      result: 'PASS',
      commit: 'abcdef1234567890',
      details: 'Exact-head validation passed.',
      at: '2026-08-10T03:00:00Z',
    }],
    activity: [],
    ...overrides,
  });
}

function snapshot(root, overrides = {}) {
  const state = loadRun(root, 7);
  return {
    state,
    head: 'abcdef1234567890',
    pr: {
      number: 11,
      url: 'https://example.invalid/octo/app/pull/11',
      isDraft: true,
      headRefOid: 'abcdef1234567890',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
      ...overrides,
    },
  };
}

function exactVerdict(stage, round, result = 'pass') {
  return {
    repository: 'octo/app',
    pullRequestNumber: 11,
    issueNumber: 7,
    headSha: 'abcdef1234567890',
    stage,
    round,
    promptVersion: 1,
    result,
    summary: result === 'changes' ? 'Fix the edge case.' : 'Looks good.',
    findings: result === 'changes'
      ? [{ severity: 'blocking', message: 'Fix the edge case.', file: 'src/a.mjs', line: 3 }]
      : [],
  };
}

function githubJson(command, args) {
  assert.equal(command, 'gh');
  if (args[0] === 'repo') return { nameWithOwner: 'octo/app' };
  if (args[0] === 'issue') return {
    number: 7,
    title: 'Fix review workflow',
    body: '## Acceptance criteria\n- Use the configured review workflow.',
    url: 'https://example.invalid/octo/app/issues/7',
    comments: [],
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
  };
  if (args[0] === 'pr') return {
    number: 11,
    state: 'OPEN',
    isDraft: true,
    headRefOid: 'abcdef1234567890',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    url: 'https://example.invalid/octo/app/pull/11',
  };
  throw new Error(`Unexpected gh call: ${args.join(' ')}`);
}

function fakeRunner(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { ok: true, stdout: '', stderr: '' };
  };
}

function installFakeGh(t, root) {
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = path.join(bin, process.platform === 'win32' ? 'gh.cmd' : 'gh');
  if (process.platform === 'win32') {
    writeFileSync(script, '@echo off\r\nif "%1"=="label" if "%2"=="list" echo []\r\nexit /b 0\r\n');
  } else {
    writeFileSync(script, '#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === "label" && args[1] === "list") process.stdout.write("[]");\nprocess.exit(0);\n');
    chmodSync(script, 0o755);
  }
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous || ''}`;
  t.after(() => { process.env.PATH = previous; });
}

test('configured workflow selects Light or Heavy review with independent round counters', () => {
  assert.equal(configuredReviewStage(config('quick-manual')), 'quick');
  assert.equal(configuredReviewStage(config('quick-web-chatgpt')), 'quick');
  assert.equal(configuredReviewStage(config('full-immediate')), 'full');
  assert.deepEqual(configuredReviewRound({ events: [
    { event: 'harness-review', stage: 'quick', round: 1, result: 'changes' },
    { event: 'harness-review', stage: 'full', round: 1, result: 'changes' },
  ] }, config('quick-manual')), { stage: 'quick', round: 2 });
  assert.deepEqual(configuredReviewRound({ events: [
    { event: 'harness-review', stage: 'quick', round: 1, result: 'pass' },
    { event: 'harness-review', stage: 'full', round: 1, result: 'changes' },
  ] }, config('full-immediate')), { stage: 'full', round: 2 });
});

test('controller harness review persists exact structured Light review evidence', (t) => {
  const root = repository(t);
  initialRun(root);
  const calls = [];
  const auditCalls = [];
  const review = runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config('quick-manual'),
    jsonRunner: githubJson,
    auditRunner: fakeRunner(auditCalls),
    agentRunner(command, args) {
      calls.push({ command, args });
      assert.equal(command, 'paseo');
      assert.ok(args.includes('--output-schema'));
      assert.match(args.at(-1), /This is a QUICK review/);
      return exactVerdict('quick', 1, 'pass');
    },
  });
  assert.equal(review.decision.action, 'quick-passed');
  assert.equal(review.event.event, 'harness-review');
  assert.equal(review.event.stage, 'quick');
  assert.equal(review.event.headSha, 'abcdef1234567890');
  assert.equal(review.audit?.verdict, 'APPROVED');
  assert.deepEqual(auditCalls[0].args.slice(0, 3), ['pr', 'comment', '11']);
  assert.match(auditCalls[0].args[4], /Commit: `abcdef1234567890`/);
  const state = loadRun(root, 7);
  assert.equal(state.events.at(-1).result, 'pass');
  assert.equal(state.events.some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.commit === 'abcdef1234567890'), true);
  assert.equal(calls.length, 1);
});

test('controller rejects an otherwise passing verdict when GitHub head moved before acceptance', (t) => {
  const root = repository(t);
  initialRun(root);
  const auditCalls = [];
  const review = runConfiguredHarnessReview(root, 7, snapshot(root), {
    config: config('full-immediate'),
    jsonRunner(command, args) {
      if (args[0] === 'pr') return { ...githubJson(command, args), headRefOid: 'deadbee1234567890' };
      return githubJson(command, args);
    },
    agentRunner() { return exactVerdict('full', 1, 'pass'); },
    auditRunner: fakeRunner(auditCalls),
  });
  assert.equal(review.decision.action, 'stale');
  assert.equal(review.event.result, 'stale');
  assert.equal(review.audit?.verdict, 'APPROVED');
  assert.equal(auditCalls.length, 1);
  const state = loadRun(root, 7);
  assert.equal(state.events.at(-1).result, 'stale');
  assert.equal(state.events.some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && event.commit === 'abcdef1234567890'), true);
});

test('Quick to Manual handoff marks draft ready, releases coding capacity, and records exact-head handoff', (t) => {
  const root = repository(t);
  initialRun(root);
  const calls = [];
  const review = {
    repository: 'octo/app',
    issue: {
      number: 7,
      title: 'Fix review workflow',
      body: 'body',
      url: 'https://example.invalid/octo/app/issues/7',
    },
    decision: { action: 'handoff', target: 'full-manual', round: 3, limit: 3 },
    event: {
      event: 'harness-review', stage: 'quick', round: 3, result: 'changes', headSha: 'abcdef1234567890',
      findings: [{ severity: 'blocking', message: 'Verify edge case.', file: 'src/a.mjs' }],
    },
    state: loadRun(root, 7),
  };
  const result = enterConfiguredQuickHandoff(root, 7, snapshot(root), review, {
    config: config('quick-manual'),
    runner: fakeRunner(calls),
  });
  assert.equal(result.target, 'manual');
  assert.deepEqual(calls[0].args, ['pr', 'ready', '11']);
  assert.deepEqual(calls[1].args.slice(0, 3), ['pr', 'comment', '11']);
  assert.match(calls[1].args[4], /Verify edge case/);
  assert.deepEqual(calls[2].args.slice(0, 3), ['issue', 'edit', '7']);
  const state = loadRun(root, 7);
  assert.equal(state.phase, 'manual-review');
  assert.equal(state.reviewRuntimeStage, 'full-manual');
  assert.equal(state.reviewExpectedHeadSha, 'abcdef1234567890');
  assert.equal(state.events.at(-1).event, 'harness-review-handoff');
  assert.equal(loadIssueLifecycle(root, 7, { limit: 20 }).some((event) => event.type === 'pr-review-queued'), true);
});

test('Quick to Web ChatGPT pre-seeds full-stage metadata before the serial job is visible', (t) => {
  const root = repository(t);
  installFakeGh(t, root);
  initialRun(root);
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
  });
  const calls = [];
  const review = {
    repository: 'octo/app',
    issue: {
      number: 7,
      title: 'Fix review workflow',
      body: 'body',
      url: 'https://example.invalid/octo/app/issues/7',
    },
    decision: { action: 'quick-passed' },
    event: {
      event: 'harness-review', stage: 'quick', round: 1, result: 'pass', headSha: 'abcdef1234567890', findings: [],
    },
    state: loadRun(root, 7),
  };
  const result = enterConfiguredQuickHandoff(root, 7, snapshot(root), review, {
    config: config('quick-web-chatgpt', 3, 4),
    runner: fakeRunner(calls),
    ensureLabels: () => [],
    setLabels: () => ({ changed: true }),
  });
  assert.equal(result.target, 'web-chatgpt');
  const store = loadPrReviewStore(root);
  const job = store.reviewJobs.find((item) => item.id === result.reviewJob.id);
  const metadata = webChatGptFullReviewMetadata(root, job.id);
  assert.equal(metadata.stage, 'full');
  assert.equal(metadata.stageRound, 1);
  assert.equal(metadata.maxStageRounds, 4);
  assert.match(reviewWorkerPath(root, job.id), /web-chatgpt-full-review-worker\.mjs$/);
  assert.equal(loadRun(root, 7).reviewRuntimeStage, 'full-web-chatgpt');
  const release = calls.find((call) => call.command === 'gh' && call.args[0] === 'issue' && call.args[1] === 'edit');
  assert.deepEqual(release.args, ['issue', 'edit', '7', '--remove-label', 'paseo:coding']);
});

test('Heavy review exhaustion releases coding capacity and records Needs Attention', (t) => {
  const root = repository(t);
  initialRun(root);
  const calls = [];
  const review = {
    stage: 'full',
    round: 3,
    decision: { action: 'attention', limit: 3 },
  };
  const state = markReviewNeedsAttention(root, 7, snapshot(root), review, { runner: fakeRunner(calls) });
  assert.equal(state.phase, 'review-attention');
  assert.equal(state.status, 'paseo:needs-attention');
  assert.ok(state.completedAt);
  assert.deepEqual(calls[0].args.slice(0, 3), ['issue', 'edit', '7']);
  assert.ok(calls[0].args.includes('paseo:needs-attention'));
  assert.deepEqual(calls[1].args.slice(0, 3), ['pr', 'edit', '11']);
  assert.ok(calls[1].args.includes('paseo:changes-requested'));
  assert.equal(loadIssueLifecycle(root, 7, { limit: 20 }).some((event) => event.type === 'review-needs-attention'), true);
});
