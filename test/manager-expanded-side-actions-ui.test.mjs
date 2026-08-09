import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('collapsed Issue Lifecycle rows hide Details and Actions but keep the row chevron', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-work-details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-actions-toggle/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /lifecycle-chevron/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-row-head \.lifecycle-row-actions>\[data-work-details\]/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-row-head \.lifecycle-row-actions>\[data-actions-toggle\]/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /display:none!important/);
});

test('expanded issue moves Details and Actions into the right column above Activity Timeline', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /function arrangeExpandedControls\(\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /lifecycle-expanded-side/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /lifecycle-expanded-actions/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /activity\.replaceWith\(side\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /side\.append\(activity\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /side\.prepend\(controls\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /\[data-work-details\],\[data-actions-toggle\],\.lifecycle-actions-popover/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-expanded-actions\{display:flex/);
});

test('expanded controls preserve the existing troubleshooting and action implementations', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /openDrawer\(item, event\.currentTarget\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Actions ▾/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Reconcile now/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Retry PR review/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Recover issue/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Abandon/);
});

test('expanded control placement is restored after status rerenders', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /new MutationObserver\(arrangeExpandedControls\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /observer\.observe\(list, \{ childList: true, subtree: true \}\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Issue troubleshooting and actions/);
});
