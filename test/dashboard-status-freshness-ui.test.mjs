import assert from 'node:assert/strict';
import test from 'node:test';
import { DASHBOARD_POLL_SCRIPT } from '../src/dashboard-poll-script.mjs';

test('dashboard polling renders freshness states and preserves old data through transient failures', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /Up to date/);
  assert.match(DASHBOARD_POLL_SCRIPT, /Refreshing status/);
  assert.match(DASHBOARD_POLL_SCRIPT, /Data may be stale/);
  assert.match(DASHBOARD_POLL_SCRIPT, /Refresh failed · showing local data/);
  assert.match(DASHBOARD_POLL_SCRIPT, /consecutiveFailures >= 2/);
  assert.match(DASHBOARD_POLL_SCRIPT, /Existing data is still displayed/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /Dashboard status polling exceeded 20 seconds/);
});

test('refreshing responses schedule a bounded follow-up without overlapping requests', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /REFRESH_FOLLOW_UP_MS = 2_000/);
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(!meta\.refreshing \|\| followUpTimer\) return/);
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /efficientRefreshStatus\(\{ force: true, background: true \}\)/);
});

test('the poll health chip is owned by freshness rendering rather than the old countdown', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /startCountdown = function/);
  assert.match(DASHBOARD_POLL_SCRIPT, /renderStatusFreshness\(dashboardData\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /Next poll pending/);
});
