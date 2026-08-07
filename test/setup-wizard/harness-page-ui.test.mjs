import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithHarnessPage,
  HARNESS_PAGE_SCRIPT,
} from '../../src/setup-wizard/harness-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('harness page UI exposes provider, independent model, thinking, refresh, and acknowledgement controls', () => {
  const html = enhanceSetupWizardWithHarnessPage(setupWizardHtml({ requestedPage: 'harness' }));

  assert.match(html, /data-setup-harness-page/);
  assert.match(html, /\/api\/setup\/harness\/status/);
  assert.match(html, /\/api\/setup\/harness\/save/);
  assert.match(html, /\/api\/setup\/harness\/recheck/);
  assert.match(html, /Coding harness/);
  assert.match(html, /Coding model/);
  assert.match(html, /Review model/);
  assert.match(html, /Thinking level/);
  assert.match(html, /No Paseo model required/);
  assert.match(html, /does not expose selectable models/);
  assert.match(html, /Quick review/);
  assert.match(html, /full review/i);
  assert.match(html, /Refresh catalog/);
});

test('harness UI intercepts page Recheck but leaves other pages to the shell', () => {
  assert.match(HARNESS_PAGE_SCRIPT, /if \(!onHarnessPage\(\)\) return/);
  assert.match(HARNESS_PAGE_SCRIPT, /stopImmediatePropagation/);
  assert.match(HARNESS_PAGE_SCRIPT, /refresh\(true\)/);
  assert.doesNotMatch(HARNESS_PAGE_SCRIPT, /paseo provider models/);
});
