import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUES_MAP_LAYOUT_UI_SCRIPT } from '../src/issues-map-layout-ui-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('Graph health is placed above Execution waves', () => {
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /cardByHeading\(view, 'Graph health'\)/);
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /cardByHeading\(view, 'Execution waves'\)/);
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /insertBefore\(graphHealth, executionWaves\)/);
});

test('Graph health renders as cards and Execution waves uses two columns', () => {
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /#graph-health>\.component/);
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /#execution-waves\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(ISSUES_MAP_LAYOUT_UI_SCRIPT, /@media\(max-width:760px\).*#execution-waves\{grid-template-columns:1fr\}/);
});

test('dashboard installs the Issues Map layout script', () => {
  const html = dashboardHtml();
  assert.match(html, /issues-map-layout-style/);
  assert.match(html, /issues-map-primary/);
});

test('PR browser configuration exposes only the project conversation action', () => {
  const html = dashboardHtml();
  assert.match(html, />Use current conversation<\/button>/);
  assert.match(html, /browser\/use-current'\),\{scope:'project'\}/);
  assert.doesNotMatch(html, /Use current for project/);
  assert.doesNotMatch(html, /Use current globally/);
  assert.doesNotMatch(html, /scope:'global'/);
});
