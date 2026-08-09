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

test('issue plans use a per-repository stale-while-revalidate cache', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const issuePlanCache = new Map\(\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const issuePlanInFlight = new Map\(\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const ISSUE_PLAN_CACHE_MS = 15000/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /function issuePlanFingerprint\(plan\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /issuePlanCache\.get\(repositoryId\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(cached\?\.plan\) renderIssuePlanSnapshot\(repositoryId, cached\.plan, cached\.fingerprint\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(issuePlanInFlight\.has\(repositoryId\)\) return issuePlanInFlight\.get\(repositoryId\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(!force && cacheAge !== null && cacheAge < ISSUE_PLAN_CACHE_MS\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /renderedIssuePlanRepositoryId/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /renderedIssuePlanFingerprint/);
});

test('unchanged issue plans do not rebuild the Issues list or dependency map', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /repositoryId !== renderedIssuePlanRepositoryId \|\| fingerprint !== renderedIssuePlanFingerprint/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(changed\) \{\s*renderIssuePlan\(plan\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /window\.renderManagerIssueDependencyMap\(plan, repositoryId\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const \{ entry \} = storeIssuePlan\(repositoryId, plan\)/);
});

test('entering Issues reuses the cached snapshot instead of forcing a reload', () => {
  assert.match(
    MANAGER_ISSUES_PR_REVIEWS_SCRIPT,
    /function onViewChanged\(\) \{\s*patchVisibleHeader\(\);\s*if \(activeView\(\) === 'automation'\) loadIssuePlan\(\);\s*else clearIssuePlanRefreshTimer\(\);\s*\}/,
  );
  assert.match(
    MANAGER_ISSUES_PR_REVIEWS_SCRIPT,
    /try \{ if \(typeof currentStatus !== 'undefined' && currentStatus\) render\(currentStatus\); \} catch \{\}\s*if \(activeView\(\) === 'automation'\) loadIssuePlan\(\);/,
  );
});

test('a cache hit schedules one deferred revalidation instead of leaving the issue plan stale indefinitely', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /let issuePlanRefreshTimer = null/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /function scheduleIssuePlanRefresh\(delayMs\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(issuePlanRefreshTimer !== null\) return/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /scheduleIssuePlanRefresh\(ISSUE_PLAN_CACHE_MS - cacheAge\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /scheduleIssuePlanRefresh\(ISSUE_PLAN_CACHE_MS\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /issuePlanRefreshTimer = setTimeout/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(activeView\(\) === 'automation'\) loadIssuePlan\(\)/);
});

test('manual refresh and issue-changing actions invalidate the cached plan immediately', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const ISSUE_PLAN_INVALIDATING_ACTIONS = new Set/);
  for (const action of ['config', 'run-now', 'reconcile', 'start-issue', 'skip-issue', 'unskip-issue', 'restart-issue', 'abandon-issue']) {
    assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, new RegExp("'" + action.replace('/', '\\/') + "'"));
  }
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /refresh\?\.addEventListener\('click'/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /invalidateIssuePlan\(repositoryId\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /loadIssuePlan\(\{ force: true \}\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /issuePlanInvalidatingPostRepositoryAction/);
});

test('manager status invalidates the issue plan only when issue-run state changes', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const issuePlanStatusRevision = new Map\(\)/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /lastDispatchAt: automation\.lastDispatchAt/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /activeRunCount: Number\(automation\.activeRunCount/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /runCount: Number\(automation\.runCount/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /statusCounts: automation\.statusCounts/);
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(previous != null && previous !== next\) invalidateIssuePlan\(repositoryId\)/);
  assert.doesNotMatch(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /lastTickAt: worker/);
});

test('leaving Issues cancels a deferred issue-plan refresh', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /if \(activeView\(\) === 'automation'\) loadIssuePlan\(\);\s*else clearIssuePlanRefreshTimer\(\)/);
});

test('Issues and PR Reviews subscribe directly to the manager status hub', () => {
  assert.match(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /window\.addManagerStatusListener\(render\)/);
  assert.doesNotMatch(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /window\.renderStatus\s*=/);
  assert.doesNotMatch(MANAGER_ISSUES_PR_REVIEWS_SCRIPT, /const previous = window\.renderStatus/);
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
