import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOGS_UI_SCRIPT } from '../src/logs-ui-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('dashboard installs a dedicated Logs tab with filters and export controls', () => {
  const html = dashboardHtml();
  assert.match(html, /LOGS_UI_SCRIPT|controller-logs-style|logs-nav/);
  assert.match(html, /Controller logs/);
  assert.match(html, /data-view=\\?"logs\\?"|dataset\.view = 'logs'/);
  assert.match(html, /id=\\?"view-logs\\?"/);
  assert.match(html, /id=\\?"logs-query\\?"/);
  assert.match(html, /id=\\?"logs-level\\?"/);
  assert.match(html, /id=\\?"logs-category\\?"/);
  assert.match(html, /id=\\?"logs-limit\\?"/);
  assert.match(html, /Copy visible/);
  assert.match(html, /Download JSON/);
  assert.match(html, /Read-only refresh polling is not logged/);
});

test('Logs tab loads filtered events and refreshes only while visible', () => {
  assert.match(LOGS_UI_SCRIPT, /fetch\('\/api\/logs\?' \+ logQueryString\(\)/);
  assert.match(LOGS_UI_SCRIPT, /params\.set\('limit'/);
  assert.match(LOGS_UI_SCRIPT, /params\.set\('level'/);
  assert.match(LOGS_UI_SCRIPT, /params\.set\('category'/);
  assert.match(LOGS_UI_SCRIPT, /params\.set\('query'/);
  assert.match(LOGS_UI_SCRIPT, /logsVisible\(\)/);
  assert.match(LOGS_UI_SCRIPT, /document\.hidden/);
  assert.match(LOGS_UI_SCRIPT, /setInterval[\s\S]*5_000/);
  assert.match(LOGS_UI_SCRIPT, /navigator\.clipboard\.writeText/);
  assert.match(LOGS_UI_SCRIPT, /URL\.createObjectURL/);
});

test('server exposes read-only logs and records mutating and automated actions', () => {
  const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /request\.method === 'GET' && url\.pathname === '\/api\/logs'/);
  assert.match(source, /listControllerLogs\(root/);
  assert.match(source, /logApiActionStarted\(root/);
  assert.match(source, /logApiActionSucceeded\(root/);
  assert.match(source, /logApiActionFailed\(root/);
  assert.match(source, /action: 'dispatch-issue-work'/);
  assert.match(source, /action: 'reconcile-pr-states'/);
  assert.match(source, /action: 'start-pr-review'/);
  assert.doesNotMatch(source, /logApiActionStarted\(root[^\n]*\/api\/logs/);
});

test('logging modules are included in syntax validation', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.check, /src\/controller-log\.mjs/);
  assert.match(packageJson.scripts.check, /src\/logs-ui-script\.mjs/);
  assert.match(packageJson.scripts.check, /src\/server-action-log\.mjs/);
});
