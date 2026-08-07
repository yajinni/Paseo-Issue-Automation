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

test('ChatGPT Profile shows real Playwright and Chromium prerequisite checks with conditional installers', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /prerequisiteRow\('Playwright', playwrightReady, playwrightAction\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /prerequisiteRow\('Chromium', chromiumReady, chromiumAction\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /Install Playwright/);
  assert.match(REVIEW_PAGE_SCRIPT, /Install Chromium/);
  assert.match(REVIEW_PAGE_SCRIPT, /playwrightReady \? ''/);
  assert.match(REVIEW_PAGE_SCRIPT, /chromiumReady \? ''/);
  assert.match(REVIEW_PAGE_SCRIPT, /review\/playwright\/install/);
  assert.match(REVIEW_PAGE_SCRIPT, /review\/chromium\/install/);
});

test('ChatGPT Profile login is enabled by browser prerequisites and no longer requires a recheck', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /const browserReady = playwrightReady && chromiumReady/);
  assert.match(REVIEW_PAGE_SCRIPT, /const missing = !browserReady \|\| !conversation/);
  assert.match(REVIEW_PAGE_SCRIPT, /Log into ChatGPT Profile/);
  assert.match(REVIEW_PAGE_SCRIPT, /browserReady \? '' : 'disabled'/);
  assert.match(REVIEW_PAGE_SCRIPT, /never asks for or stores your ChatGPT password/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /then Recheck/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /id="review-profile-recheck"/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, />Recheck<\/button>/);
});

test('PR review chat URL is last in the profile card, auto-saves, and shows a green Saved indicator', () => {
  const loginIndex = REVIEW_PAGE_SCRIPT.indexOf('Log into ChatGPT Profile');
  const urlIndex = REVIEW_PAGE_SCRIPT.indexOf('PR review chat URL');
  assert.ok(urlIndex > loginIndex);
  assert.match(REVIEW_PAGE_SCRIPT, /review-chat-saved/);
  assert.match(REVIEW_PAGE_SCRIPT, /color:#65c987/);
  assert.match(REVIEW_PAGE_SCRIPT, />Saved<\/span>/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-chat-url[^]*addEventListener\('input'/);
  assert.match(REVIEW_PAGE_SCRIPT, /review-chat-url[^]*addEventListener\('change', saveChat\)/);
  assert.match(REVIEW_PAGE_SCRIPT, /mode: 'existing'/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Save review chat/);
});

test('profile instructions do not make login verification a setup gate', () => {
  assert.match(REVIEW_PAGE_SCRIPT, /Log into ChatGPT Profile if needed/);
  assert.match(REVIEW_PAGE_SCRIPT, /close Chromium when you are finished/);
  assert.match(REVIEW_PAGE_SCRIPT, /The URL saves automatically/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /profile\.ready/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Signed in and ready/);
});

test('removed ChatGPT Profile controls and repository-access copy stay absent', () => {
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Create\/use a dedicated PR review chat/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /Use an existing chat/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /safe review-protocol capability check/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, /must not modify repository state/);
  assert.doesNotMatch(REVIEW_PAGE_SCRIPT, />Open ChatGPT Profile</);
});

test('review page enhancer injects the progressive page script once', () => {
  const html = enhanceSetupWizardWithReviewPage('<html><body><main></main></body></html>');
  assert.match(html, /data-setup-review-page/);
  assert.equal((html.match(/data-setup-review-page/g) || []).length, 1);
});
