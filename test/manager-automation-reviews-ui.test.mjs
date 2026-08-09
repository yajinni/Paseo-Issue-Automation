import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithAutomationReviews,
  MANAGER_AUTOMATION_REVIEWS_SCRIPT,
  MANAGER_AUTOMATION_REVIEWS_STYLE,
} from '../src/manager-automation-reviews-ui.mjs';

test('Automation view separates claims scheduling from status-only coding worker state', () => {
  for (const text of ['Claims & scheduling', 'Coding worker', 'Automatically available for new issue coding and review fixes', "['Status', worker.state === 'active' ? 'Active' : 'Idle']"]) {
    assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const action of ['resume', 'pause', 'run-now', 'reconcile']) {
    assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const action of ['worker/start', 'worker/stop', 'worker/restart']) {
    assert.doesNotMatch(MANAGER_AUTOMATION_REVIEWS_SCRIPT, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Reviews view exposes workflow worker review workload and ChatGPT Profile state', () => {
  for (const text of ['Review workflow', 'Review workload', 'PR-review worker', 'ChatGPT Profile']) {
    assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, new RegExp(text));
  }
  for (const action of ['review-worker/start', 'review-worker/stop', 'review-worker/restart']) {
    assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, new RegExp(action.replace('/', '\\/')));
  }
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /chatGptProfile/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /setupPath \|\| '\/setup\/review'/);
});

test('Reviews sidebar badge is derived from current work-queue review stages', () => {
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /REVIEW_STAGES/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /workQueue\?\.items/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /changes-requested/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /review-failed/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /data-manager-badge="reviews"/);
});

test('Automation and Reviews subscribe directly to the manager status hub', () => {
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /window\.addManagerStatusListener\(render\)/);
  assert.doesNotMatch(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /window\.renderStatus\s*=/);
  assert.doesNotMatch(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /const previous = window\.renderStatus/);
});

test('old mixed automation diagnostics are retained only as technical details', () => {
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /Technical automation status/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /manager-technical-details/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_SCRIPT, /oldControls\?\.remove/);
});

test('Automation and Reviews layout collapses to one column on small screens', () => {
  assert.match(MANAGER_AUTOMATION_REVIEWS_STYLE, /@media\(max-width:760px\)/);
  assert.match(MANAGER_AUTOMATION_REVIEWS_STYLE, /manager-ops-grid\{grid-template-columns:1fr\}/);
});

test('enhancer appends style and script without replacing the existing manager document', () => {
  const html = enhanceManagerWithAutomationReviews('<html><head></head><body><main class="shell"></main></body></html>');
  assert.match(html, /data-manager-automation-reviews-style/);
  assert.match(html, /data-manager-automation-reviews/);
  assert.match(html, /<main class="shell"><\/main>/);
});
