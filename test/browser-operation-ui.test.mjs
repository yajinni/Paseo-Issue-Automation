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
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Chromium and dedicated browser state removed and verified/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /deleting the dedicated ChatGPT profile, login, selected conversation/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /profile and login will be preserved/);
});

test('Chromium button setup cannot create a self-triggering DOM mutation loop', () => {
  assert.match(
    BROWSER_OPERATION_UI_SCRIPT,
    /if \(text === 'uninstall browser'\) button\.textContent = 'Uninstall Chromium'/,
  );
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /new MutationObserver\(renameUninstallControl\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /observer\.observe\(document\.body/);
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
