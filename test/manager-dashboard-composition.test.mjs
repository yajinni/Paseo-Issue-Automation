import assert from 'node:assert/strict';
import test from 'node:test';
import { managerDashboardHtml } from '../src/manager-server.mjs';

test('manager status hub is installed before every status-consuming UI enhancer', () => {
  const html = managerDashboardHtml();
  const statusHub = html.indexOf('data-manager-status-events');
  assert.ok(statusHub >= 0, 'manager status hub should be present');
  for (const marker of [
    'data-manager-navigation',
    'data-manager-work-queue',
    'data-manager-automation-reviews',
    'data-manager-config-integration',
    'data-manager-configuration-tabs',
    'data-manager-issues-pr-reviews',
    'data-manager-issue-processing-flow',
  ]) {
    const index = html.indexOf(marker);
    assert.ok(index > statusHub, marker + ' should load after the manager status hub');
  }
});

test('interaction polish remains the final manager enhancer', () => {
  const html = managerDashboardHtml();
  const interaction = html.indexOf('data-manager-interaction');
  assert.ok(interaction > html.indexOf('data-manager-issue-processing-flow'));
  assert.ok(interaction < html.indexOf('</body>'));
});
