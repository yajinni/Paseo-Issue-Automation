import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithIssuesPrReviews,
  MANAGER_ISSUES_PR_REVIEWS_SCRIPT,
  MANAGER_ISSUES_PR_REVIEWS_STYLE,
} from '../src/manager-issues-pr-reviews-ui.mjs';

test('manager relabels Automation as Issues and Reviews as PR Reviews', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /textContent = 'Issues'/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /textContent = 'PR Reviews'/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /Open Issues/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /Open PR Reviews/);
});

test('Issues view exposes workflow worker and full issue workload plan', () => {
  for (const text of ['Issue workflow', 'Issue-processing worker', 'Issue workload', 'Lowest eligible issue number first', 'Native GitHub blocked-by relationships']) {
    assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const action of ['worker/start', 'worker/stop', 'worker/restart', 'resume', 'pause', 'run-now', 'reconcile']) {
    assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, new RegExp(action.replace('/', '\\/')));
  }
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /processingOrder/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /Blocked by:/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /data-manager-badge=\"automation\"/);
});

test('PR Reviews removes ChatGPT Profile and orders workflow worker workload', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /findCard\(view, 'ChatGPT Profile'\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /profile\?\.remove\(\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /layout\.append\(workflow, worker, workload\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /Light model review → Manual review/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /Light model review → Web ChatGPT full review/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /I selected a heavy review model to do the job\./);
});

test('Issues and PR Reviews become single-column layouts on smaller screens', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_STYLE, /@media\(max-width:900px\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_STYLE, /manager-issues-layout.*grid-template-columns:1fr/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_STYLE, /manager-pr-reviews-layout\{grid-template-columns:1fr/);
});

test('enhancer injects Issues and PR Reviews assets without replacing manager markup', () => {
  const html = enhanceManagerWithIssuesPrReviews('<html><head></head><body><main class="shell"></main></body></html>');
  assert.match(html, /data-manager-issues-pr-reviews-style/);
  assert.match(html, /data-manager-issues-pr-reviews/);
  assert.match(html, /<main class="shell"><\/main>/);
});
