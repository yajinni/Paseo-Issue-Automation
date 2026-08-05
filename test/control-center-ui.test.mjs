import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardHtml } from '../src/ui.mjs';

test('dashboard exposes operations, issue map, activity, settings, and PR review views', () => {
  const html = dashboardHtml();
  for (const view of ['overview', 'issues', 'dependencies', 'activity', 'settings', 'pr-reviews']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`id="view-${view}"`));
  }
  assert.doesNotMatch(html, /data-view="maintenance"/);
  assert.doesNotMatch(html, /id="view-maintenance"/);
  assert.match(html, />Issues Map<\/button>/);
  assert.match(html, /Needs your review/);
  assert.match(html, /Execution waves/);
  assert.match(html, /Dependency map/);
  assert.match(html, /Issue execution board/);
});

test('controller actions use explicit issue-processing language without manual dispatch', () => {
  const html = dashboardHtml();
  assert.match(html, /id="controller-action-state"/);
  assert.match(html, /id="claims-toggle-button"/);
  assert.doesNotMatch(html, /id="run-now-button"/);
  assert.doesNotMatch(html, /id="reconcile-button"/);
  assert.doesNotMatch(html, /\/api\/run-now/);
  assert.doesNotMatch(html, />Run now</);
  assert.match(html, /Controller loading/);
  assert.match(html, /Read-only discovery/);
  assert.match(html, /Setup required/);
  assert.match(html, /Stop Issues Processing/);
  assert.match(html, /Resume Issues Processing/);
  assert.match(html, /Issues Processing unavailable/);
  assert.match(html, /Issues Processing running/);
  assert.match(html, /Issues Processing stopped/);
  assert.doesNotMatch(html, /id="resume-button"/);
  assert.doesNotMatch(html, /id="pause-button"/);
  assert.doesNotMatch(html, /classList\.toggle\('hidden', !operational\)/);
});

test('PR review controls remove redundant refresh and move the review toggle to the top action bar', () => {
  const html = dashboardHtml();
  assert.match(html, /refreshButton\.remove\(\)/);
  assert.match(html, /Force Sync PR States/);
  assert.match(html, /actionBar\.appendChild\(reviewToggle\)/);
  assert.match(html, /Resume PR Reviews/);
  assert.match(html, /Pause PR Reviews/);
  assert.match(html, /Immediately compare managed pull requests with GitHub/);
});

test('ChatGPT browser controls show Chromium and project-chat readiness without low-level metadata', () => {
  const html = dashboardHtml();
  assert.match(html, /Chromium Installed/);
  assert.match(html, /PR Review Chat URL/);
  assert.match(html, /browser\.chromium\.installed/);
  assert.match(html, /Reset profile/);
  assert.doesNotMatch(html, /GPT Chat Selected/);
  assert.doesNotMatch(html, /GPT chat not selected/);
  assert.doesNotMatch(html, /Profile lock: <strong>/);
  assert.doesNotMatch(html, /Reset ChatGPT Credentials/);
  assert.doesNotMatch(html, /browser\.library\.installed/);
});

test('setup does not hide read-only repository views', () => {
  const html = dashboardHtml();
  assert.doesNotMatch(html, /showView\('settings'\).*setupComplete/);
  assert.match(html, /Repository issues and GitHub issue relationships are available read-only/);
});

test('dashboard presents deterministic controller configuration without an Orchestrator model field', () => {
  const html = dashboardHtml();
  assert.match(html, /Issue Execution Controller/);
  assert.match(html, /Coder model/);
  assert.match(html, /Independent Reviewer model/);
  assert.match(html, /coderThinking/);
  assert.match(html, /reviewerThinking/);
  assert.doesNotMatch(html, /Orchestrator model/);
});

test('setup replaces free-text configuration with discovered branch, harness, model, and thinking selectors', () => {
  const html = dashboardHtml();
  assert.match(html, /refresh-setup-options/);
  assert.match(html, /transformBaseBranch\(\)/);
  assert.match(html, /transformModelControl\('coder', 'Coder'\)/);
  assert.match(html, /transformModelControl\('reviewer', 'Independent Reviewer'\)/);
  assert.match(html, /Refresh branches and models/);
  assert.match(html, /Models are loaded from the selected Paseo harness/);
  assert.match(html, /thinkingOptionIds/);
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
  assert.match(html, /id="pr-override-dialog"/);
  assert.match(html, /prefers-reduced-motion/);
});
