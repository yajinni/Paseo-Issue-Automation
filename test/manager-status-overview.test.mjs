import assert from 'node:assert/strict';
import test from 'node:test';
import { managerHtml } from '../src/manager-maintenance-ui.mjs';

test('manager surfaces repository operational state before detailed controls', () => {
  const html = managerHtml();
  const overviewIndex = html.indexOf('class="manager-overview"');
  const repositoryCardIndex = html.indexOf('<h2>Repository</h2>');

  assert.ok(overviewIndex >= 0);
  assert.ok(repositoryCardIndex > overviewIndex);
  assert.match(html, /aria-label="Selected repository overview"/);
  assert.match(html, /id="overview-issue-processing"/);
  assert.match(html, /id="overview-claims"/);
  assert.match(html, /id="overview-coding-worker"/);
  assert.match(html, /id="overview-review-worker"/);
  assert.match(html, /id="overview-active-work"/);
  assert.match(html, /id="overview-attention"/);
});

test('manager overview derives status and recovery action from existing health model', () => {
  const html = managerHtml();

  assert.match(html, /const operational = data\.operational \|\| \{\}/);
  assert.match(html, /operational\.primaryBlocker \|\| blockers\[0\]/);
  assert.match(html, /item\.severity === 'error' \|\| item\.severity === 'warning'/);
  assert.match(html, /overview-status-title/);
  assert.match(html, /Automation needs attention/);
  assert.match(html, /No repository-specific blockers are currently reported/);
  assert.match(html, /blockerActionElement\(primary\?\.action\)/);
  assert.match(html, /postRepositoryAction\(action\.endpoint\)/);
  assert.match(html, /document\.getElementById\(action\.targetId\)\?\.click\(\)/);
});

test('manager overview remains responsive without replacing detailed health and maintenance', () => {
  const html = managerHtml();

  assert.match(html, /@media\(max-width:900px\).*overview-metrics\{grid-template-columns:repeat\(3/m);
  assert.match(html, /@media\(max-width:560px\).*overview-metrics\{grid-template-columns:repeat\(2/m);
  assert.match(html, /id="repository-health-panel"/);
  assert.match(html, /id="repository-maintenance-panel"/);
  assert.match(html, /renderManagerOverview\(data\)/);
  assert.match(html, /renderRepositoryHealth\(data\)/);
  assert.match(html, /renderExternalMaintenance\(data\)/);
});
