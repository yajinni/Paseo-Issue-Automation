import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithWorkQueue,
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('Work Queue becomes the Issue Lifecycle surface with separate status and stage filters', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Issue Lifecycle/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-search/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-filter/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-stage-filter/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /All recorded work/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /All stages/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Available/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Claimed/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Ready \/ Backlog/);
});

test('expanded issue shows the selected nine-stage lifecycle and fixing retry loop', () => {
  for (const label of [
    'Available', 'Claimed', 'Coding', 'Draft PR Created', 'PR Review Queued',
    'Reviewing', 'Merged', 'Issue Closure Verified', 'Completed',
  ]) assert.match(MANAGER_WORK_QUEUE_SCRIPT, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /lifecycle-expanded/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /If changes requested/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Fixing/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /returns to review/);
});

test('coding and review details share the same lower-left detail card', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Coding details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.coding\?\.model/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.coding\?\.thinking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.model/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.thinking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.type === 'web-chatgpt'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Browser conversation/);
});

test('expanded issue always renders the selected right-side Activity Timeline style', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Activity Timeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /activityTimeline\(item\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /panel\.append\(main, activityTimeline\(item\)\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-event::before/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /background:#2b6fc5/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-time/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /color:#62a0f6/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.activity-icon/);
});

test('manual intervention is consolidated into Actions while Details remains deep troubleshooting', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Actions ▾/);
  for (const action of ['start-issue', 'skip-issue', 'unskip-issue', 'restart-issue', 'abandon-issue']) {
    assert.match(MANAGER_WORK_QUEUE_SCRIPT, new RegExp(action));
  }
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Recovery mode/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Recover existing work first/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Start fresh and delete old branch/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Skip issue #/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Dangerous issue actions require the manager confirmation layer/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Advanced manual issue controls and raw action result/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Manual issue action/);
});

test('Details drawer is a deep diagnostic view rather than a second pretty timeline', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Deep troubleshooting/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Dashboard and run state/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Repository controller context/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Execution identity/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /PR and review evidence/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Recorded lifecycle evidence/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Raw lifecycle label/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Raw phase/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Worktree path/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Coder agent ID/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Current head SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Validation head SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Approved head SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Merged head SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Latest dispatch result/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Repository blockers/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /PR-review automation record/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Stored review state/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Last submitted review SHA/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review job state/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Fix job state/);
});

test('detail drawer remains an accessible modal with focus containment and focus restoration', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /setAttribute\('role', 'dialog'\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /setAttribute\('aria-labelledby', 'work-detail-title'\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-detail-scrim/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /drawerReturnFocus/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /event\.key === 'Escape'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /event\.key !== 'Tab'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /drawerFocusables/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-work-details/);
});

test('live status refresh preserves an open troubleshooting drawer', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /openDrawer\(selected, null, \{ preserveInteraction: true \}\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /const scrollTop = options\.preserveInteraction \? drawer\.scrollTop : 0/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /drawer\.scrollTop = scrollTop/);
});

test('issue list includes footer pagination and keeps expanded state scoped to the visible page', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /PAGE_SIZE = 10/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-pagination/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /renderPagination/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Showing /);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /lifecycle-pagination/);
});

test('repository removal is preserved by moving it to Maintenance before old Work Queue panels are replaced', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /preserveRepositoryRemoval/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /remove-button/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-manager-view="maintenance"/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Repository registration/);
});

test('base renderStatus compatibility sink remains even though raw action output is removed from normal UI', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /id="dispatch-result" class="work-queue-compat"/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /work-queue-compat\{display:none!important\}/);
});

test('Work Queue subscribes directly to the manager status hub and preserves badge behavior', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /window\.addManagerStatusListener\(renderStatusQueue\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-manager-badge="work-queue"/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Number\(queueData\.active \|\| 0\) \+ Number\(queueData\.attention \|\| 0\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /classList\.toggle\('attention'/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /window\.renderStatus\s*=/);
});

test('Issue Lifecycle UI is responsive down to a full-width troubleshooting drawer', () => {
  assert.match(MANAGER_WORK_QUEUE_STYLE, /@media\(max-width:900px\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /@media\(max-width:560px\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /work-detail-drawer\{width:100%/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /lifecycle-expanded\{grid-template-columns:1fr\}/);
});

test('Work Queue enhancer loads after navigation without affecting setup HTML by itself', () => {
  const html = enhanceManagerWithWorkQueue('<html><head></head><body><main data-manager-view="work-queue"></main></body></html>');
  assert.match(html, /data-manager-work-queue-style/);
  assert.match(html, /data-manager-work-queue/);
  assert.ok(html.indexOf('data-manager-work-queue-style') < html.indexOf('</head>'));
  assert.ok(html.indexOf('data-manager-work-queue') < html.indexOf('</body>'));
});
