import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { DASHBOARD_POLL_SCRIPT } from '../src/dashboard-poll-script.mjs';

function dashboardContext(response) {
  const chip = { textContent: '', className: '' };
  const context = {
    AbortController,
    Date,
    Math,
    Number,
    Object,
    Promise,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { hash: '' },
    document: {
      hidden: false,
      getElementById(id) {
        return id === 'health-poll' ? chip : null;
      },
      addEventListener() {},
    },
    window: {},
    dashboardData: null,
    countdownTimer: null,
    refreshStatus() {},
    startCountdown() {},
    postAction() {},
    api: async () => response,
    render() {},
    renderHealth() {},
    renderCounts() {},
    renderHumanReview() {},
    renderActiveExecution() {},
    renderDependencyQueue() {},
    renderScheduling() {},
    renderActivity() {},
    renderIssueBoard() {},
    renderDependencies() {},
    toast() {},
  };
  vm.runInNewContext(DASHBOARD_POLL_SCRIPT, context);
  return { context, chip };
}

test('freshness chip reads remote status nested under automation', async () => {
  const { context, chip } = dashboardContext({
    automation: {
      statusMeta: {
        state: 'fresh',
        refreshing: false,
        remoteAgeMs: 0,
        remoteUpdatedAt: '2026-08-05T23:00:00.000Z',
        lastError: null,
      },
    },
  });

  await context.window.refreshStatus({ force: true });

  assert.equal(chip.textContent, 'Up to date · just now');
  assert.equal(chip.className, 'chip good');
});

test('freshness chip keeps supporting top-level status metadata', async () => {
  const { context, chip } = dashboardContext({
    statusMeta: {
      state: 'failed',
      refreshing: false,
      remoteAgeMs: 10_000,
      lastError: 'GitHub unavailable',
    },
  });

  await context.window.refreshStatus({ force: true });

  assert.equal(chip.textContent, 'Refresh failed · showing local data');
  assert.equal(chip.className, 'chip bad');
});
