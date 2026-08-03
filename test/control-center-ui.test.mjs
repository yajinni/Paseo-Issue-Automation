import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardHtml } from '../src/ui.mjs';

test('dashboard exposes operations, dependency, activity, settings, and maintenance views', () => {
  const html = dashboardHtml();
  for (const view of ['overview', 'issues', 'dependencies', 'activity', 'settings', 'maintenance']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`id="view-${view}"`));
  }
  assert.match(html, /Needs your review/);
  assert.match(html, /Execution waves/);
  assert.match(html, /Dependency map/);
  assert.match(html, /Issue execution board/);
});

test('dashboard presents deterministic controller configuration without an Orchestrator model field', () => {
  const html = dashboardHtml();
  assert.match(html, /Issue Execution Controller/);
  assert.match(html, /Coder model/);
  assert.match(html, /Independent Reviewer model/);
  assert.doesNotMatch(html, /Orchestrator model/);
});

test('setup replaces free-text configuration with discovered branch, harness, and model selectors', () => {
  const html = dashboardHtml();
  assert.match(html, /refresh-setup-options/);
  assert.match(html, /transformBaseBranch\(\)/);
  assert.match(html, /transformModelControl\('coder', 'Coder'\)/);
  assert.match(html, /transformModelControl\('reviewer', 'Independent Reviewer'\)/);
  assert.match(html, /Refresh branches and models/);
  assert.match(html, /Models are loaded from the selected Paseo harness/);
});

test('requirements have detail dialogs and a forced uncached refresh', () => {
  const html = dashboardHtml();
  assert.match(html, /requirement-details-dialog/);
  assert.match(html, /Why it is needed/);
  assert.match(html, /How it is checked/);
  assert.match(html, /How to enable or fix it/);
  assert.match(html, /\/api\/status\?refresh=setup/);
  assert.match(html, /requirements-check-again/);
  assert.match(html, /Last checked:/);
});

test('dashboard includes accessible navigation, details, and confirmation dialogs', () => {
  const html = dashboardHtml();
  assert.match(html, /Skip to dashboard content/);
  assert.match(html, /aria-label="Dashboard sections"/);
  assert.match(html, /id="issue-dialog"/);
  assert.match(html, /id="action-dialog"/);
  assert.match(html, /prefers-reduced-motion/);
});
