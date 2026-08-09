import assert from 'node:assert/strict';
import test from 'node:test';
import { managerRepositoryAction } from '../src/manager-actions.mjs';

function fakeActions(calls) {
  return {
    setClaimsEnabled: (root, enabled) => { calls.push(['claims', root, enabled]); return { claimsEnabled: enabled }; },
    dispatchAvailableIssues: (root) => { calls.push(['dispatch', root]); return { claimed: false, reason: 'none' }; },
    updateManagedDispatch: (root, result) => { calls.push(['dispatch-state', root, result]); },
    reconcileDependencies: (root) => { calls.push(['reconcile', root]); return { changed: 0 }; },
    loadConfig: (root) => ({
      root,
      version: 3,
      baseBranch: 'main',
      maxActive: 1,
      pollIntervalSeconds: 120,
      maxReviewRounds: 4,
      codingHarness: 'provider-a',
      issueSelection: {
        mode: 'all-open',
        excludedLabels: ['manual'],
        temporaryFailureRetries: 5,
      },
      review: {
        workflow: 'quick-manual',
        quickMaxRounds: 3,
        fullMaxRounds: 4,
        autoMergeApproved: false,
      },
      models: { coder: 'old/coder', reviewer: 'old/reviewer' },
      workspace: { id: 'workspace-a', title: 'Issue Coding Automation' },
    }),
    saveConfig: (root, config) => { calls.push(['config', root, config]); return config; },
    dispatchSpecificCodingIssue: (root, issue, options) => { calls.push(['start', root, issue, options]); return { issue }; },
    skipIssue: (root, issue) => { calls.push(['skip', root, issue]); return { issue }; },
    unskipIssue: (root, issue) => { calls.push(['unskip', root, issue]); return { issue }; },
    abandonAttempt: (root, issue, reason) => { calls.push(['abandon', root, issue, reason]); return { issue }; },
    queueCodingIssueRestart: (root, issue, options) => {
      calls.push(['restart-queued', root, issue, options]);
      return { queued: true, issueNumber: issue, phase: 'queued' };
    },
    appendControllerLog: (root, entry) => { calls.push(['controller-log', root, entry]); return entry; },
    appendIssueLifecycle: (root, issue, entry) => { calls.push(['lifecycle', root, issue, entry]); return entry; },
  };
}

test('manager actions map pause, resume, dispatch, and reconciliation to one root', () => {
  const calls = [];
  const actions = fakeActions(calls);
  assert.deepEqual(managerRepositoryAction('/repo-a', '/api/pause', {}, actions), { claimsEnabled: false });
  assert.deepEqual(managerRepositoryAction('/repo-a', '/api/resume', {}, actions), { claimsEnabled: true });
  assert.deepEqual(managerRepositoryAction('/repo-a', '/api/run-now', {}, actions), { claimed: false, reason: 'none' });
  assert.deepEqual(managerRepositoryAction('/repo-a', '/api/reconcile', {}, actions), { changed: 0 });
  assert.deepEqual(calls.filter((entry) => entry[0] === 'claims').slice(0, 2), [
    ['claims', '/repo-a', false],
    ['claims', '/repo-a', true],
  ]);
  assert.ok(calls.some((entry) => entry[0] === 'dispatch-state' && entry[1] === '/repo-a'));
  assert.ok(calls.some((entry) => entry[0] === 'reconcile' && entry[1] === '/repo-a'));
});

test('manager configuration merges nested selections without dropping existing values', () => {
  const calls = [];
  const actions = fakeActions(calls);
  const result = managerRepositoryAction('/repo-b', '/api/config', {
    maxActive: 3,
    review: { autoMergeApproved: true },
    models: { coder: 'new/coder' },
  }, actions);
  assert.equal(result.maxActive, 3);
  assert.equal(result.models.coder, 'new/coder');
  assert.equal(result.models.reviewer, 'old/reviewer');
  assert.equal(result.codingHarness, 'provider-a');
  assert.equal(result.issueSelection.mode, 'all-open');
  assert.deepEqual(result.issueSelection.excludedLabels, ['manual']);
  assert.equal(result.issueSelection.temporaryFailureRetries, 5);
  assert.equal(result.review.workflow, 'quick-manual');
  assert.equal(result.review.fullMaxRounds, 4);
  assert.equal(result.review.autoMergeApproved, true);
  assert.equal(result.workspace.id, 'workspace-a');
  const saved = calls.find((entry) => entry[0] === 'config');
  assert.equal(saved[1], '/repo-b');
});

test('manager issue actions validate issue numbers and queue restart without running it inline', () => {
  const calls = [];
  const actions = fakeActions(calls);
  managerRepositoryAction('/repo-c', '/api/start-issue', { issueNumber: 12, branchAction: 'delete' }, actions);
  managerRepositoryAction('/repo-c', '/api/skip-issue', { issueNumber: 12 }, actions);
  managerRepositoryAction('/repo-c', '/api/unskip-issue', { issueNumber: 12 }, actions);
  const restart = managerRepositoryAction('/repo-c', '/api/restart-issue', { issueNumber: 12, branchAction: 'keep' }, actions);
  managerRepositoryAction('/repo-c', '/api/abandon-issue', { issueNumber: 12, reason: 'operator stop' }, actions);
  assert.ok(calls.some((entry) => entry[0] === 'start' && entry[3].branchAction === 'delete'));
  assert.ok(calls.some((entry) => entry[0] === 'restart-queued' && entry[3].branchAction === 'keep'));
  assert.equal(restart.queued, true);
  assert.ok(calls.some((entry) => entry[0] === 'abandon' && entry[3] === 'operator stop'));
  assert.throws(
    () => managerRepositoryAction('/repo-c', '/api/start-issue', { issueNumber: 0 }, actions),
    /positive issueNumber/,
  );
  assert.equal(managerRepositoryAction('/repo-c', '/api/not-allowed', {}, actions), null);
});

test('manual issue actions append readable operator lifecycle entries for the Activity Timeline', () => {
  const calls = [];
  const actions = fakeActions(calls);
  managerRepositoryAction('/repo-d', '/api/skip-issue', { issueNumber: 27 }, actions);
  managerRepositoryAction('/repo-d', '/api/restart-issue', { issueNumber: 27, branchAction: 'keep' }, actions);
  managerRepositoryAction('/repo-d', '/api/abandon-issue', { issueNumber: 27, reason: 'operator stop' }, actions);

  const lifecycle = calls.filter((entry) => entry[0] === 'lifecycle');
  assert.equal(lifecycle.length, 3);
  assert.equal(lifecycle[0][2], 27);
  assert.equal(lifecycle[0][3].type, 'operator-action');
  assert.equal(lifecycle[0][3].source, 'operator');
  assert.match(lifecycle[0][3].message, /Skip issue completed/i);
  assert.equal(lifecycle[1][3].evidence.action, 'restart-issue');
  assert.equal(lifecycle[1][3].evidence.branchAction, 'keep');
  assert.equal(lifecycle[2][3].evidence.action, 'abandon-issue');
});

test('failed manual issue actions append failed lifecycle evidence before rethrowing', () => {
  const calls = [];
  const actions = fakeActions(calls);
  actions.skipIssue = () => { throw new Error('skip failed'); };
  assert.throws(() => managerRepositoryAction('/repo-e', '/api/skip-issue', { issueNumber: 28 }, actions), /skip failed/);
  const lifecycle = calls.find((entry) => entry[0] === 'lifecycle');
  assert.equal(lifecycle[2], 28);
  assert.equal(lifecycle[3].status, 'failed');
  assert.match(lifecycle[3].message, /Skip issue failed/i);
  assert.match(lifecycle[3].evidence.error, /skip failed/i);
});
