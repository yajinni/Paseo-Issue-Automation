import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_OPERATION_UI_SCRIPT } from '../src/browser-operation-ui-script.mjs';
import { DASHBOARD_POLL_SCRIPT } from '../src/dashboard-poll-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('Chromium install uses a compact auto-closing status dialog', () => {
  const html = dashboardHtml();
  assert.match(html, /browser-operation-dialog/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /width:min\(380px/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Installing Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Expected install time: 30–60 seconds\./);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /if \(!dialog\.open\) dialog\.show\(\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /dialog\.close\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /Command output/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browser-operation-command/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browser-operation-track/);
});

test('Chromium uninstall waits for confirmation modal to close before progress starts', () => {
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /window\.confirmChromiumUninstall/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Type UNINSTALL to continue/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /dialog\.addEventListener\('close', startUninstall, \{ once: true \}\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /setTimeout\(function\(\) \{\s*runBrowserOperation\(UNINSTALL_PATH\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /button\.onclick = window\.confirmChromiumUninstall/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Uninstalling Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Chromium and dedicated browser state removed and verified/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /dialog\.close\(\);\s*return runBrowserOperation\(UNINSTALL_PATH\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browserOperationWrapped/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /MutationObserver/);
});

test('Chromium progress-window failures release the operation lock', () => {
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /try \{\s*dialog = prepareDialog\(installing\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /operationActive = false;\s*toast\('Could not open the Chromium progress window:/);
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
