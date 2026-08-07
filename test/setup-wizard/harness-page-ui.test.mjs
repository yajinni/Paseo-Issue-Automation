import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithHarnessPage,
  HARNESS_PAGE_SCRIPT,
} from '../../src/setup-wizard/harness-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('harness page UI exposes section refresh controls, required highlighting, and automatic saves', () => {
  const html = enhanceSetupWizardWithHarnessPage(setupWizardHtml({ requestedPage: 'harness' }));

  assert.match(html, /data-setup-harness-page/);
  assert.match(html, /\/api\/setup\/harness\/status/);
  assert.match(html, /\/api\/setup\/harness\/save/);
  assert.match(html, /\/api\/setup\/harness\/recheck/);
  assert.match(html, /Provider \/ Coding Harness/);
  assert.match(html, /Coding model/);
  assert.match(html, /Review model/);
  assert.match(html, /Thinking level/);
  assert.match(html, /No Paseo model required/);
  assert.match(html, /does not expose selectable models/);
  assert.match(html, /Refresh coding harnesses/);
  assert.match(html, /Refresh coding models/);
  assert.match(html, /Refresh review models/);
  assert.match(html, /required-missing/);
  assert.match(html, /harness-coding-model[^]*save\(readForm\(\)\)/);
  assert.match(html, /harness-review-model[^]*save\(readForm\(\)\)/);
  assert.match(html, /harness-coding-thinking[^]*save\(readForm\(\)\)/);
  assert.match(html, /harness-review-thinking[^]*save\(readForm\(\)\)/);
});

test('harness page uses the requested review guidance and removes catalog status', () => {
  const html = enhanceSetupWizardWithHarnessPage(setupWizardHtml({ requestedPage: 'harness' }));

  assert.match(html, /Select a light or same model as the coding model if you just want to do a quick check on the code before letting it move on to human PR review, another heavy external PR review workflow, or will use our web ChatGPT setup for review\./);
  assert.match(html, /Pick your heavy PR review model if you wont be doing one of the above bullet options and want the PR review cycle to start immediately\./);
  assert.match(html, /<ul class="review-guidance">/);
  assert.doesNotMatch(html, /<h3>Catalog status<\/h3>/);
  assert.doesNotMatch(html, /Refresh catalog/);
});

test('harness page hides shell Recheck and shows visible loading and waiting states', () => {
  assert.match(HARNESS_PAGE_SCRIPT, /recheck\.hidden = onHarnessPage\(\)/);
  assert.match(HARNESS_PAGE_SCRIPT, /Checking available coding harnesses from Paseo/);
  assert.match(HARNESS_PAGE_SCRIPT, /Waiting for the coding harness catalog before checking available coding models/);
  assert.match(HARNESS_PAGE_SCRIPT, /Waiting for the coding harness catalog before checking available review models/);
  assert.match(HARNESS_PAGE_SCRIPT, /setRefreshBusy\(true, busyLabel\)/);
  assert.doesNotMatch(HARNESS_PAGE_SCRIPT, /stopImmediatePropagation/);
});
