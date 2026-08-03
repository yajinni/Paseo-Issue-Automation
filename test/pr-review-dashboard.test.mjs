import assert from 'node:assert/strict';
import test from 'node:test';
import { prReviewDashboardHtml } from '../src/pr-review-dashboard.mjs';

test('PR dashboard separates serial review from coding and exposes required controls', () => {
  const html = prReviewDashboardHtml();
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
});
