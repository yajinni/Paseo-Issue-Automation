import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('each lifecycle milestone becomes an accessible in-page focus control', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data\.lifecycleFocus|dataset\.lifecycleFocus/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /setAttribute\('role', 'button'\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /step\.tabIndex = 0/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /aria-label/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /event\.key === 'Enter'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /event\.key === ' '/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-step\[role="button"\]/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /:focus-visible/);
});

test('stage focus stays inside the expanded issue rather than navigating to separate pages', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Focused lifecycle stage/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Show all/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /applyPanelFocus/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /focusedStage/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /location\.href\s*=.*lifecycle/i);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /window\.open\(.*lifecycle/i);
});

test('coding focus exposes recorded model thinking harness branch and workspace', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'coding'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.coding\?\.model/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.coding\?\.thinking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.coding\?\.harness/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.branch/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.workspaceId/);
});

test('PR and review stages focus the current PR and exact review evidence', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'draft-pr'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'review-queued'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'reviewing'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Head SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Issue association/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Queue position/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review request/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review type/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Exact head/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.type === 'web-chatgpt'/);
});

test('merge closure and completion focus expose terminal evidence', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'merged'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'closure-verified'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /stage === 'completed'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Merged head/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Issue closure pending/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Lifecycle completion pending/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Completed at/);
});

test('Activity Timeline remains visible and highlights events for the focused stage', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /updateTimeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /eventMatchesStage/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /focus-muted/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /focus-match/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-event\.focus-muted/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-event\.focus-match/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-card\.stage-focused/);
});

test('stage focus survives lifecycle rerenders while the same issue remains expanded', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /MutationObserver/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /focusedIssue !== visibleIssue/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /wirePanel/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /queueMicrotask\(apply\)/);
});
