import assert from 'node:assert/strict';
import test from 'node:test';
import { prReviewDashboardHtml } from '../src/pr-review-dashboard.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('PR review management is integrated into the main dashboard', () => {
  const html = dashboardHtml();
  assert.match(html, /data-view="pr-reviews"/);
  assert.match(html, /id="view-pr-reviews"/);
  assert.match(html, /Several builders, one inspector/);
  assert.match(html, /Active inspector/);
  assert.match(html, /Waiting review line/);
  assert.match(html, /Managed pull requests/);
  assert.match(html, /Project review settings/);
  assert.match(html, /Dedicated ChatGPT browser/);
  assert.match(html, /Review now/);
  assert.match(html, /One-time review destination/);
  assert.match(html, /Retry failed submission/);
  assert.match(html, /Manual review result/);
  assert.match(html, /Allow ChatGPT merge/);
  assert.match(html, /Diagnostic screenshot/);
  assert.match(html, /closed\/reopen/);
  assert.doesNotMatch(html, /href="\/pr-reviews"/);
});

test('legacy PR review route redirects into the integrated tab', () => {
  const html = prReviewDashboardHtml();
  assert.match(html, /location\.replace\('\/#pr-reviews'\)/);
  assert.match(html, /content="0;url=\/#pr-reviews"/);
  assert.doesNotMatch(html, /<h1>Serial PR Review<\/h1>/);
});
