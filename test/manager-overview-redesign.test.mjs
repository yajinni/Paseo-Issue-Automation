import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_NAVIGATION_SCRIPT,
  MANAGER_NAVIGATION_STYLE,
} from '../src/manager-navigation-ui.mjs';

test('overview keeps the operational summary and adds concise current work and latest activity', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /appendPanel\(views\.overview, overview, moved\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /overviewSupport\(\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /<h2>Current work<\/h2>/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /<h2>Latest controller activity<\/h2>/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /automation\.activeRunCount/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /automation\.runCount/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /automation\.statusCounts/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /automation\.lastDispatchAt/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /dispatchSummary\(automation\.lastDispatchResult\)/);
});

test('overview does not expose raw dispatch JSON as its primary activity result', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /result\.message \|\| result\.summary \|\| result\.reason \|\| result\.status \|\| result\.action/);
  assert.doesNotMatch(MANAGER_NAVIGATION_SCRIPT, /overview-latest-result[^]*JSON\.stringify/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /Open Work Queue/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /Open Automation/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /Open Maintenance/);
});

test('repository and setup diagnostics move out of Overview into Integration', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /appendPanel\(views\.integration, panelByHeading\(shell, 'Repository'\), moved\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /appendPanel\(views\.integration, panelByHeading\(shell, 'Setup'\), moved\)/);
  assert.doesNotMatch(MANAGER_NAVIGATION_SCRIPT, /appendPanel\(views\.overview, panelByHeading\(shell, 'Repository'\)/);
  assert.doesNotMatch(MANAGER_NAVIGATION_SCRIPT, /appendPanel\(views\.overview, panelByHeading\(shell, 'Setup'\)/);
});

test('overview and sidebar expose freshness and only server-backed attention badges', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /manager-last-updated/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /lastUpdatedAt = Date\.now\(\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /setInterval\(renderLastUpdated, 1000\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /setBadge\('work-queue', Number\(automation\.activeRunCount \|\| 0\), false\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /item\.severity === 'error' \|\| item\.severity === 'warning'/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /setBadge\('maintenance', attentionCount, attentionCount > 0\)/);
  assert.match(MANAGER_NAVIGATION_STYLE, /manager-nav-badge\.attention/);
});

test('overview support cards collapse to one column on narrow screens', () => {
  assert.match(MANAGER_NAVIGATION_STYLE, /manager-overview-support\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(MANAGER_NAVIGATION_STYLE, /@media\(max-width:720px\)\{\.manager-overview-support\{grid-template-columns:1fr\}\}/);
});
