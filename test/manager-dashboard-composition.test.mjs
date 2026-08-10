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

test('manager status hub loads once before every direct status consumer with no capture boundaries', () => {
  const html = managerDashboardHtml();
  const hub = html.indexOf('<script data-manager-status-events>');
  assert.ok(hub >= 0, 'manager status hub should be present');
  assert.equal(html.match(/data-manager-status-events/g)?.length, 1);
  assert.doesNotMatch(html, /data-manager-status-capture/);
  assert.doesNotMatch(html, /captureManagerStatusRenderer/);

  let cursor = hub;
  for (const marker of STATUS_CONSUMERS) {
    const consumer = html.indexOf('<script ' + marker + '>', cursor + 1);
    assert.ok(consumer > cursor, marker + ' should load after the status hub and previous enhancer');
    cursor = consumer;
  }
});

test('all status-consuming enhancers register through the listener API in the composed document', () => {
  const html = managerDashboardHtml();
  assert.ok((html.match(/addManagerStatusListener/g) || []).length >= STATUS_CONSUMERS.length + 1);
  assert.doesNotMatch(html, /managerNavigationRenderStatus/);
  assert.doesNotMatch(html, /managerWorkQueueRenderStatus/);
  assert.doesNotMatch(html, /managerIssuesPrReviewsRenderStatus/);
  assert.doesNotMatch(html, /unifiedIssueProcessingRenderStatus/);
  assert.doesNotMatch(html, /managerConfigIntegrationRenderStatus/);
});

test('composed Configuration exposes the six setup-aligned tabs without obsolete setup-link cards', () => {
  const html = managerDashboardHtml();
  for (const label of ['Connect Paseo', 'Coding harness', 'GitHub repository', 'Issues setup', 'Review setup', 'Readiness']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /manager-config-step-link/);
  assert.doesNotMatch(html, /removeSetupLinkCards/);
});

test('interaction polish remains final after the direct status consumers', () => {
  const html = managerDashboardHtml();
  const interaction = html.indexOf('<script data-manager-interaction>');
  const issueFlow = html.indexOf('<script data-manager-issue-processing-flow>');
  assert.ok(interaction > issueFlow);
  assert.ok(interaction < html.indexOf('</body>'));
});