import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT,
  MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE,
} from '../src/manager-work-queue-table-polish-ui.mjs';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('Issue Lifecycle desktop rows and headers share explicit aligned column tracks', () => {
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /--lifecycle-row-columns:/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /\.lifecycle-columns,\.lifecycle-row-head\{grid-template-columns:var\(--lifecycle-row-columns\)/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /min-width:1181px/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /min-width:901px/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /nth-child\(3\)\{padding-left:13px\}/);
});

test('Run Details wraps model identity after the final slash instead of truncating it', () => {
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT, /lastIndexOf\('\/'\)/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT, /value\.slice\(0, slash \+ 1\)/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT, /value\.slice\(slash \+ 1\)/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT, /lifecycle-run-provider/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT, /lifecycle-run-model/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /\.lifecycle-run-secondary\{[^}]*white-space:normal[^}]*overflow:visible[^}]*text-overflow:clip/);
  assert.match(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE, /overflow-wrap:anywhere/);
});

test('table polish is composed after the existing Issue Lifecycle UI assets', () => {
  assert.ok(MANAGER_WORK_QUEUE_STYLE.endsWith(MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE));
  assert.ok(MANAGER_WORK_QUEUE_SCRIPT.endsWith(MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT));
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /managerWorkQueueTablePolish/);
});
