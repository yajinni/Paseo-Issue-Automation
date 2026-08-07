import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSetupWizardWithReviewPage, REVIEW_PAGE_SCRIPT } from '../../src/setup-wizard/review-page-ui.mjs';

test('review setup UI uses the user-facing workflow names while preserving stable workflow ids', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /value="quick-manual"/);
  assert.match(REVIEW_PAGE_SCRIPT, /Light model review → Manual review/);
  assert.match(REVIEW_PAGE_SCRIPT, /value="quick-web-chatgpt"/);
  assert.match(REVIEW_PAGE_SCRIPT, /Light model review → Web ChatGPT full review/);
  assert.match(REVIEW_PAGE_SCRIPT, /value="full-immediate"/);
  assert.match(REVIEW_PAGE_SCRIPT, /I selected a heavy review model to do the job\./);
  assert.match(REVIEW_PAGE_SCRIPT, /Maximum light-model review and correction rounds/);
  assert.match(REVIEW_PAGE_SCRIPT, /max="20"/);
});

test('manual review hides the irrelevant full-review round control and preserves its saved value', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /const manualReview = s\.workflow === 'quick-manual'/);
  assert.match(REVIEW_PAGE_SCRIPT, /const fullRoundsControl = manualReview \? ''/);
  assert.match(REVIEW_PAGE_SCRIPT, /Maximum full-review and correction rounds/);
  assert.match(REVIEW_PAGE_SCRIPT, /state\?\.selection\?\.fullMaxRounds \|\| 3/);
});

test('review workflow, round, and auto-merge changes save immediately', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /input\[name="review-workflow"\][^]*addEventListener\('change', saveSettings\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-quick-rounds[^]*addEventListener\('change', saveSettings\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-full-rounds[^]*addEventListener\('change', saveSettings\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-auto-merge[^]*addEventListener\('change', saveSettings\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /Review settings save automatically when changed/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /id="review-save"/);
});

test('eligible workflows offer opt-in coding PR auto-merge without policy bypass', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /review-auto-merge/);
  assert.match(REVIEW_PAGE_SCRIPT, /Off by default/);
  assert.match(REVIEW_PAGE_SCRIPT, /exact current head has full approval/);
  assert.match(REVIEW_PAGE_SCRIPT, /never bypasses checks, reviews, protections, or rulesets/);
  assert.match(REVIEW_PAGE_SCRIPT, /unavailable for Light model review → Manual review/);
});

test('Prompt previews are not shown in Review setup', () => {
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Prompt previews/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Quick prompt:/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Full prompt:/);
});

test('Web ChatGPT conditional section uses ChatGPT Profile and highlights missing required readiness', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /<h3>ChatGPT Profile<\/h3>/);
  assert.match(REVIEW_PAGE_SCRIPT, /Open ChatGPT Profile/);
  assert.match(REVIEW_PAGE_SCRIPT, /never asks for or stores your ChatGPT password/);
  assert.match(REVIEW_PAGE_SCRIPT, /cardClass\(missing\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /required-missing/);
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
