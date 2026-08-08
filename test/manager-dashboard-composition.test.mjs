import assert from 'node:assert/strict';
import test from 'node:test';
import { managerDashboardHtml } from '../src/manager-server.mjs';

const STATUS_CONSUMERS = [
  'data-manager-navigation',
  'data-manager-work-queue',
  'data-manager-automation-reviews',
  'data-manager-config-integration',
  'data-manager-configuration-tabs',
  'data-manager-issues-pr-reviews',
  'data-manager-issue-processing-flow',
];

test('manager status hub captures each status-consuming enhancer before the next enhancer loads', () => {
  const html = managerDashboardHtml();
  let cursor = html.indexOf('data-manager-status-events');
  assert.ok(cursor >= 0, 'manager status hub should be present');

  for (const marker of STATUS_CONSUMERS) {
    const consumer = html.indexOf(marker, cursor + 1);
    assert.ok(consumer > cursor, marker + ' should load after the previous status boundary');
    const capture = html.indexOf('data-manager-status-capture', consumer + 1);
    assert.ok(capture > consumer, marker + ' should be captured after it loads');
    cursor = capture;
  }

  assert.equal(html.match(/data-manager-status-capture/g)?.length, STATUS_CONSUMERS.length);
});

test('interaction polish remains final and does not need a status-renderer capture', () => {
  const html = managerDashboardHtml();
  const lastCapture = html.lastIndexOf('data-manager-status-capture');
  const interaction = html.indexOf('<script data-manager-interaction>');
  const issueFlow = html.indexOf('<script data-manager-issue-processing-flow>');
  assert.ok(interaction > lastCapture);
  assert.ok(interaction > issueFlow);
  assert.ok(interaction < html.indexOf('</body>'));
});
