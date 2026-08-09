import assert from 'node:assert/strict';
import test from 'node:test';
import { managerOverviewStatus } from '../src/manager-overview-status.mjs';

function status(overrides = {}) {
  return {
    blockers: [],
    workQueue: {
      items: [],
      prHealth: { byIssue: {} },
    },
    ...overrides,
  };
}

test('overview lists active issues oldest first and excludes available/terminal work', () => {
  const result = managerOverviewStatus(status({
    workQueue: {
      items: [
        { issueNumber: 2, title: 'Newer coding', stage: 'coding', stageLabel: 'Coding', startedAt: '2026-08-09T12:00:00.000Z' },
        { issueNumber: 1, title: 'Older review', stage: 'reviewing', stageLabel: 'Reviewing', startedAt: '2026-08-08T12:00:00.000Z' },
        { issueNumber: 3, title: 'Available', stage: 'ready', stageLabel: 'Available', startedAt: '2026-08-07T12:00:00.000Z' },
        { issueNumber: 4, title: 'Done', stage: 'completed', stageLabel: 'Completed', completedAt: '2026-08-09T13:00:00.000Z' },
      ],
      prHealth: { byIssue: {} },
    },
  }));

  assert.deepEqual(result.activeIssues.map((item) => item.issueNumber), [1, 2]);
  assert.equal(result.activeIssues[0].stageLabel, 'Reviewing');
});

test('active PR uses managed PR creation time before workflow fallbacks', () => {
  const result = managerOverviewStatus(status({
    workQueue: {
      items: [{
        issueNumber: 42,
        title: 'Improve overview',
        stage: 'reviewing',
        stageLabel: 'Reviewing',
        startedAt: '2026-08-09T10:00:00.000Z',
        updatedAt: '2026-08-09T11:00:00.000Z',
        pullRequest: { number: 77, url: 'https://github.test/pull/77' },
        review: { label: 'Heavy review' },
        timeline: [{ type: 'pr-opened', at: '2026-08-09T10:30:00.000Z', detail: 'PR #77 opened' }],
      }],
      prHealth: {
        byIssue: {
          42: {
            status: 'healthy', label: 'Healthy', tone: 'success', problemCount: 0,
            currentPr: { number: 77, state: 'OPEN', url: 'https://github.test/pull/77' },
            problems: [],
          },
        },
      },
    },
  }), {
    prReviewStore: {
      managedPullRequests: [{
        id: 'mpr-77', issueNumber: 42, pullRequestNumber: 77,
        createdAt: '2026-08-09T10:20:00.000Z', updatedAt: '2026-08-09T10:50:00.000Z',
      }],
    },
  });

  assert.equal(result.activePullRequests.length, 1);
  assert.equal(result.activePullRequests[0].pullRequestNumber, 77);
  assert.equal(result.activePullRequests[0].reviewType, 'Heavy review');
  assert.equal(result.activePullRequests[0].startedAt, '2026-08-09T10:20:00.000Z');
  assert.equal(result.activePullRequests[0].health.status, 'healthy');
});

test('closed-unmerged PRs are not presented as active PRs', () => {
  const result = managerOverviewStatus(status({
    workQueue: {
      items: [{
        issueNumber: 7,
        title: 'Closed PR',
        stage: 'review-failed',
        stageLabel: 'Review failed',
        pullRequest: { number: 9, url: 'https://github.test/pull/9' },
      }],
      prHealth: {
        byIssue: {
          7: {
            status: 'blocking',
            currentPr: { number: 9, state: 'CLOSED', mergedAt: null },
            problems: [{ code: 'closed-unmerged', severity: 'blocking', title: 'PR closed without merge' }],
          },
        },
      },
    },
  }));

  assert.deepEqual(result.activePullRequests, []);
  assert.equal(result.needsAttention[0].title, 'PR closed without merge');
});

test('intentional Issue Claiming and PR-review stops are omitted from Needs Attention', () => {
  const result = managerOverviewStatus(status({
    blockers: [
      { code: 'claims-paused', severity: 'warning', title: 'Issue claims are paused' },
      { code: 'review-worker-stopped', severity: 'info', title: 'PR-review worker is stopped' },
      { code: 'setup-incomplete', severity: 'error', title: 'Repository setup is incomplete', message: 'Finish setup.' },
    ],
  }));

  assert.deepEqual(result.needsAttention.map((item) => item.title), ['Repository setup is incomplete']);
});

test('recent activity includes merged PRs and completed issues newest first', () => {
  const result = managerOverviewStatus(status({
    workQueue: {
      items: [
        {
          issueNumber: 10,
          title: 'Finished issue',
          stage: 'completed',
          completedAt: '2026-08-09T12:00:00.000Z',
        },
        {
          issueNumber: 11,
          title: 'Merged PR',
          stage: 'merged',
          pullRequest: { number: 33, url: 'https://github.test/pull/33' },
        },
      ],
      prHealth: {
        byIssue: {
          11: { currentPr: { number: 33, mergedAt: '2026-08-09T13:00:00.000Z' } },
        },
      },
    },
  }));

  assert.equal(result.recent[0].title, 'PR #33 merged');
  assert.equal(result.recent[1].title, 'Issue #10 completed');
});
