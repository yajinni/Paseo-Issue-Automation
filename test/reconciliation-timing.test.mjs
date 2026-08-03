import assert from 'node:assert/strict';
import test from 'node:test';
import { reconciliationDelay } from '../src/reconciliation-timing.mjs';

const config = {
  reconciliation: {
    activeIntervalMs: 45_000,
    idleIntervalMs: 300_000,
  },
};

test('reconciliation uses active cadence while actionable PRs exist', () => {
  assert.equal(reconciliationDelay({
    config,
    managedPullRequests: [{ reviewState: 'awaiting_result' }],
  }), 45_000);
});

test('reconciliation returns to idle cadence after terminal or paused work', () => {
  assert.equal(reconciliationDelay({
    config,
    managedPullRequests: [{ reviewState: 'merged' }, { reviewState: 'closed_unmerged' }, { reviewState: 'paused' }],
  }), 300_000);
});
