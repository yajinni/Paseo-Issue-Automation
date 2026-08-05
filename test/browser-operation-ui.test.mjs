import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_OPERATION_UI_SCRIPT } from '../src/browser-operation-ui-script.mjs';
import { DASHBOARD_POLL_SCRIPT } from '../src/dashboard-poll-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('Chromium install and uninstall use a visible command progress dialog', () => {
  const html = dashboardHtml();
  assert.match(html, /browser-operation-dialog/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Installing Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Uninstalling Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Uninstall Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /npx playwright install chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /npx playwright uninstall/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Command output/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Chromium installed and verified/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Chromium uninstalled and verified/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /profile and login will be preserved/);
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
