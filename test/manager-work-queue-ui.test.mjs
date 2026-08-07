import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithWorkQueue,
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('Work Queue replaces the generic issue-number surface with filterable recorded work', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-search/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-queue-filter/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /All recorded work/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Waiting for dependencies/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Changes requested/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review failed/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /queueData\.items/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.issueNumber/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.title/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.pullRequest/);
});

test('old manual issue controls remain available only as an advanced recovery surface', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Advanced manual issue controls and raw action result/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Manual issue action/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Latest action result/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /view\.replaceChildren\(queueShell\(\), advancedShell\(manual, raw\)\)/);
});

test('each queue item exposes existing issue actions without introducing new action endpoints', () => {
  for (const action of ['start-issue', 'skip-issue', 'unskip-issue', 'restart-issue', 'abandon-issue']) {
    assert.match(MANAGER_WORK_QUEUE_SCRIPT, new RegExp(action));
  }
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /postRepositoryAction\(action, payload\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /branchAction/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /skippedIssueNumbers/);
});

test('detail drawer shows exact review identity and recorded timeline', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review identity/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.headSha/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.validationApproved/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review\.reviewApproved/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /work-detail-timeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.timeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /No blocked label — native dependency wait/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Open issue #/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Open PR/);
});

test('queue badge derives from server queue counts and highlights attention', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-manager-badge="work-queue"/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Number\(queueData\.active \|\| 0\) \+ Number\(queueData\.attention \|\| 0\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /queueData\.attention/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /classList\.toggle\('attention'/);
});

test('queue UI is responsive down to a full-width detail drawer', () => {
  assert.match(MANAGER_WORK_QUEUE_STYLE, /@media\(max-width:900px\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /@media\(max-width:560px\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /work-detail-drawer\{width:100%\}/);
});

test('Work Queue enhancer loads after navigation without affecting setup HTML by itself', () => {
  const html = enhanceManagerWithWorkQueue('<html><head></head><body><main data-manager-view="work-queue"></main></body></html>');
  assert.match(html, /data-manager-work-queue-style/);
  assert.match(html, /data-manager-work-queue/);
  assert.ok(html.indexOf('data-manager-work-queue-style') < html.indexOf('</head>'));
  assert.ok(html.indexOf('data-manager-work-queue') < html.indexOf('</body>'));
});
