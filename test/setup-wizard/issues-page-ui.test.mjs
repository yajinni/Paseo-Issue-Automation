import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSetupWizardWithIssuesPage, ISSUES_PAGE_SCRIPT } from '../../src/setup-wizard/issues-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('issues page UI exposes approved selection, advanced options, and installation preview', () => {
  assert.match(ISSUES_PAGE_SCRIPT, /Recommended labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /All open issues/);
  assert.match(ISSUES_PAGE_SCRIPT, /Maximum simultaneous issues/);
  assert.match(ISSUES_PAGE_SCRIPT, /Temporary failure retries/);
  assert.match(ISSUES_PAGE_SCRIPT, /Excluded labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /Managed lifecycle labels/);
  assert.match(ISSUES_PAGE_SCRIPT, /Automation issue template/);
  assert.match(ISSUES_PAGE_SCRIPT, /api\/setup\/issues\/save/);
  assert.match(ISSUES_PAGE_SCRIPT, /api\/setup\/issues\/recheck/);
});

test('issue settings save immediately and missing preview/settings are highlighted', () => {
  assert.match(ISSUES_PAGE_SCRIPT, /input\[name="issue-mode"\][^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-max-active[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-retries[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /issues-excluded[^]*addEventListener\('change', save\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /Issue settings save automatically when changed/);
  assert.match(ISSUES_PAGE_SCRIPT, /cardClass\(settingsMissing\)/);
  assert.match(ISSUES_PAGE_SCRIPT, /cardClass\(previewMissing\)/);
  assert.doesNotMatch(ISSUES_PAGE_SCRIPT, /id="issues-save"/);
});

test('issues page enhancer adds one standalone page script without replacing shell markup', () => {
  const base = setupWizardHtml({ requestedPage: 'issues' });
  const enhanced = enhanceSetupWizardWithIssuesPage(base);
  assert.match(enhanced, /data-setup-issues-page/);
  assert.match(enhanced, /id="continue"/);
  assert.match(enhanced, /id="recheck"/);
  assert.equal((enhanced.match(/data-setup-issues-page/g) || []).length, 1);
});
