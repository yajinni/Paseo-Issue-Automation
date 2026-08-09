import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithOverviewActivity,
  MANAGER_OVERVIEW_ACTIVITY_SCRIPT,
  MANAGER_OVERVIEW_ACTIVITY_STYLE,
} from '../src/manager-overview-ui.mjs';
import { managerDashboardHtml } from '../src/manager-server.mjs';

test('Overview activity UI replaces legacy support cards with active issue and PR lists', () => {
  for (const text of [
    'Active Issues',
    'Active PRs / PR Reviews',
    'Needs Attention & Recent Changes',
    'Recently Completed',
    'View all issue work',
    'View all PR reviews',
  ]) assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /root\.textContent = ''/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /data\?\.overview/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /activeIssues/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /activePullRequests/);
});

test('Overview rows show Started and live Elapsed values from overview timestamps', () => {
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /'Started'/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /'Elapsed'/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /dataset\.startedAt/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /setInterval\(refreshElapsed, 60000\)/);
});

test('top overview metrics expose separate Active Issues and Active PR counts', () => {
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /overview-active-work/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /'Active Issues'/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /overview-active-prs/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_SCRIPT, /'Active PRs'/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_STYLE, /repeat\(7,minmax\(0,1fr\)\)/);
});

test('Overview activity layout keeps existing dashboard styling and becomes one column on narrower screens', () => {
  assert.match(MANAGER_OVERVIEW_ACTIVITY_STYLE, /manager-overview-support/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_STYLE, /background:#151f2c/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_STYLE, /@media\(max-width:900px\)/);
  assert.match(MANAGER_OVERVIEW_ACTIVITY_STYLE, /grid-template-columns:1fr!important/);
});

test('overview enhancer appends style and script and is composed into the manager dashboard', () => {
  const enhanced = enhanceManagerWithOverviewActivity('<html><head></head><body><main></main></body></html>');
  assert.match(enhanced, /data-manager-overview-activity-style/);
  assert.match(enhanced, /data-manager-overview-activity/);

  const dashboard = managerDashboardHtml();
  assert.match(dashboard, /data-manager-overview-activity/);
  assert.match(dashboard, /data-manager-coding-worker-status/);
});
