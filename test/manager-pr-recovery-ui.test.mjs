import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('Actions menu groups PR-specific recovery separately from issue controls', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /PR recovery/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Reconcile now/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /reconcile-pr/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-actions-group-title/);
});

test('Reconcile now is shown only for an issue with a managed current PR', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /managed\?\.managedId && item\.pullRequest\?\.number/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Re-read GitHub and Paseo state for the current PR/);
});

test('Retry PR review appears only for a failed or cancelled exact-current-head review job', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /exactReviewJob/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /\['failed', 'cancelled'\]\.includes/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Retry PR review/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /retry-pr-review/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /exact current PR head/);
});

test('PR recovery does not add an unsafe generic Return to coding or force-merge action', () => {
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /data-issue-action="return-to-coding"/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /data-issue-action="force-merge"/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /data-issue-action="force-close"/);
});

test('existing issue recovery controls remain available alongside PR recovery', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Start issue/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Recover issue/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Skip/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Unskip/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Abandon/);
});
