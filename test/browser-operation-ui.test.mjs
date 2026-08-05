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
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /dialog\.close\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /Command output/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browser-operation-command/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browser-operation-track/);
});

test('Chromium uninstall has a direct confirmation and progress path', () => {
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /window\.confirmChromiumUninstall/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Type UNINSTALL to continue/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /return runBrowserOperation\(UNINSTALL_PATH\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /button\.onclick = window\.confirmChromiumUninstall/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Uninstalling Chromium/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Chromium and dedicated browser state removed and verified/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /browserOperationWrapped/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /MutationObserver/);
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
