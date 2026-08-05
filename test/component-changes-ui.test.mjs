import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPONENT_CHANGES_UI_SCRIPT } from '../src/component-changes-ui-script.mjs';
import { PR_REVIEW_PANEL } from '../src/pr-review-panel.mjs';
import {
  PR_REVIEW_SETTINGS_SAVE_SCRIPT,
  prReviewSecondsToMilliseconds,
} from '../src/pr-review-settings-save-script.mjs';
import { PR_REVIEW_SETTINGS_TOGGLE_SCRIPT } from '../src/pr-review-settings-toggle-script.mjs';
import { resolveConversationUrl } from '../src/pr-review-worker.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('PR Reviews navigation is opt-in and the save behavior is installed', () => {
  const html = dashboardHtml();
  assert.match(html, /<button[^>]*class="nav-tab hidden"[^>]*id="pr-reviews-nav"/);
  assert.match(html, /moveComponents\(\)/);
  assert.match(html, /movePrSettings\(\)/);
  assert.match(html, /Enable PR Reviews/);
  assert.match(html, /Review debounce in seconds/);
  assert.match(html, /id="pr-save-settings"[^>]*type="button"/);
  assert.match(html, /installPrReviewBrowser/);
});

test('PR review panel uses only the approved browser controls and wording', () => {
  assert.match(PR_REVIEW_PANEL, /Install Chromium/);
  assert.match(PR_REVIEW_PANEL, /Use current conversation/);
  assert.match(PR_REVIEW_PANEL, /Uninstall browser/);
  assert.doesNotMatch(PR_REVIEW_PANEL, /Install dependencies \+ Chromium/);
  assert.doesNotMatch(PR_REVIEW_PANEL, /Use current for project/);
  assert.doesNotMatch(PR_REVIEW_PANEL, /Use current globally/);
  assert.doesNotMatch(PR_REVIEW_PANEL, /Uninstall browser state/);
  assert.doesNotMatch(PR_REVIEW_PANEL, /Reset and uninstall remove only machine-local browser state/);
});

test('component changes use one standard server-side Chromium install action', () => {
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /prReviewPost\('\/api\/pr-reviews\/browser\/install', \{\}\)/);
  assert.doesNotMatch(COMPONENT_CHANGES_UI_SCRIPT, /withSystemDependencies/);
  assert.doesNotMatch(COMPONENT_CHANGES_UI_SCRIPT, /shouldInstallDependencies/);
  assert.doesNotMatch(COMPONENT_CHANGES_UI_SCRIPT, /modulePath/);
  assert.doesNotMatch(COMPONENT_CHANGES_UI_SCRIPT, /const originalSave/);
  assert.doesNotMatch(COMPONENT_CHANGES_UI_SCRIPT, /Math\.round\(Number\(input\.value/);
});

test('project review settings save seconds as milliseconds and report the persisted result', () => {
  assert.equal(prReviewSecondsToMilliseconds(0), 0);
  assert.equal(prReviewSecondsToMilliseconds(15), 15_000);
  assert.equal(prReviewSecondsToMilliseconds('45'), 45_000);
  assert.equal(prReviewSecondsToMilliseconds(300), 300_000);
  assert.match(PR_REVIEW_SETTINGS_SAVE_SCRIPT, /\/api\/pr-reviews\/config/);
  assert.match(PR_REVIEW_SETTINGS_SAVE_SCRIPT, /Saving…/);
  assert.match(PR_REVIEW_SETTINGS_SAVE_SCRIPT, /Project review settings saved\./);
  assert.match(PR_REVIEW_SETTINGS_SAVE_SCRIPT, /Save failed/);
  assert.match(PR_REVIEW_SETTINGS_SAVE_SCRIPT, /window\.refreshPrReviews\(true\)/);
});

test('automatic PR review toggle preserves the existing settings cards', () => {
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /insertAdjacentHTML\('afterbegin'/);
  assert.doesNotMatch(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /container\.innerHTML\s*=/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /grid\.appendChild\(projectCard\)/);
  assert.match(PR_REVIEW_SETTINGS_TOGGLE_SCRIPT, /grid\.appendChild\(browserCard\)/);
});

test('PR review conversation resolution does not use a machine-global fallback', () => {
  const store = { config: { browserReview: { projectConversationUrl: null } } };
  const managed = { conversationUrlOverride: null };
  const job = { conversationUrlOverride: null };
  assert.equal(resolveConversationUrl(store, managed, job, { globalConversationUrl: 'https://chatgpt.com/c/global' }), null);
  store.config.browserReview.projectConversationUrl = 'https://chatgpt.com/c/project';
  assert.equal(resolveConversationUrl(store, managed, job), 'https://chatgpt.com/c/project');
  job.conversationUrlOverride = 'https://chatgpt.com/c/one-time';
  assert.equal(resolveConversationUrl(store, managed, job), 'https://chatgpt.com/c/one-time');
});
