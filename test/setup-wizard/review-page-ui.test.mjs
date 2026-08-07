import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSetupWizardWithReviewPage, REVIEW_PAGE_SCRIPT } from '../../src/setup-wizard/review-page-ui.mjs';

test('review setup UI offers all explicit workflows and independent round controls', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /quick-manual/);
  assert.match(REVIEW_PAGE_SCRIPT, /quick-web-chatgpt/);
  assert.match(REVIEW_PAGE_SCRIPT, /full-immediate/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-quick-rounds/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-full-rounds/);
  assert.match(REVIEW_PAGE_SCRIPT, /max=\\"20\\"/);
});

test('Web ChatGPT conditional section uses ChatGPT Profile as the normal user-facing name', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /<h3>ChatGPT Profile<\/h3>/);
  assert.match(REVIEW_PAGE_SCRIPT, /Open ChatGPT Profile/);
  assert.match(REVIEW_PAGE_SCRIPT, /never asks for or stores your ChatGPT password/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /dedicated Chromium profile/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /dedicated ChatGPT browser/);
});

test('review setup supports dedicated or existing stable chat URLs and safe repository readiness', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /Create\/use a dedicated PR review chat/);
  assert.match(REVIEW_PAGE_SCRIPT, /Use an existing chat/);
  assert.match(REVIEW_PAGE_SCRIPT, /stable URL/);
  assert.match(REVIEW_PAGE_SCRIPT, /safe review-protocol capability check/);
  assert.match(REVIEW_PAGE_SCRIPT, /must not modify repository state/);
  assert.match(REVIEW_PAGE_SCRIPT, /Recheck/);
});

test('review page enhancer injects the progressive page script once', () => {
  const html = enhanceSetupWizardWithReviewPage('<html><body><main></main></body></html>');
  assert.match(html, /data-setup-review-page/);
  assert.equal((html.match(/data-setup-review-page/g) || []).length, 1);
});
