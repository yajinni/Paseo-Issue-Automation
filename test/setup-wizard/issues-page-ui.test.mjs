import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSetupWizardWithIssuesPage, ISSUES_PAGE_SCRIPT } from '../../src/setup-wizard/issues-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('issues page UI exposes approved selection, advanced options, and resource previews', () => {
  assert.match(ISSUES_PAGE_SCRIPT, /Labels \(Recommended\)/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /> Recommended labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /All open issues/);
  assert.match(ISSUES_PAGE_SCRIPT, /Maximum simultaneous issues/);
  assert.match(ISSUES_PAGE_SCRIPT, /Temporary failure retries/);
  assert.match(ISSUES_PAGE_SCRIPT, /Excluded labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /Managed lifecycle labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /Automation issue template/);
  assert.match(ISSUES_PAGE_SCRIPT, /template\?\.content/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-template-preview/);
  assert.match(ISSUES_PAGE_SCRIPT, /api\/setup\/issues\/save/);
  assert.match(ISSUES_PAGE_SCRIPT, /api\/setup\/issues\/recheck/);
});

test('only issue settings can highlight the page while labels and template stay informational', () => {
  assert.match(ISSUES_PAGE_SCRIPT, /input\[name="issue-mode"\][^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-max-active[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-retries[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-excluded[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /Issue settings save automatically when changed/);
  assert.match(ISSUES_PAGE_SCRIPT, /cardClass\(settingsMissing\)/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /cardClass\(previewMissing\)/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /check-row ok/);
  assert.match(ISSUES_PAGE_SCRIPT, /<section class="setup-card"><h3>Managed lifecycle labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /<section class="setup-card"><h3>Automation issue template/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /id="issues-save"/);
});

test('managed lifecycle labels use indented text without empty status circles', () => {
  assert.match(ISSUES_PAGE_SCRIPT, /issues-label-list/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-label-row/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /<span class="check-dot">·<\/span>/);
  const enhanced = enhanceSetupWizardWithIssuesPage(setupWizardHtml({ requestedPage: 'issues' }));
  assert.match(enhanced, /\.issues-label-row\{padding:9px 0 9px 32px/);
});

test('issues page enhancer adds preview styling and one standalone page script without replacing shell markup', () => {
  const base = setupWizardHtml({ requestedPage: 'issues' });
  const enhanced = enhanceSetupWizardWithIssuesPage(base);
  assert.match(enhanced, /data-setup-issues-page-style/);
  assert.match(enhanced, /data-setup-issues-page/);
  assert.match(enhanced, /id="continue"/);
  assert.match(enhanced, /id="recheck"/);
  assert.equal((enhanced.match(/data-setup-issues-page/g) || []).length, 2);
});
