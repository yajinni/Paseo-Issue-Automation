import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_CHANGES_UI_SCRIPT,
  shouldInstallSystemBrowserDependencies,
} from '../src/component-changes-ui-script.mjs';
import { resolveConversationUrl } from '../src/pr-review-worker.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('PR Reviews navigation is opt-in and component changes script is installed', () => {
  const html = dashboardHtml();
  assert.match(html, /<button[^>]*class="nav-tab hidden"[^>]*id="pr-reviews-nav"/);
  assert.match(html, /moveComponents\(\)/);
  assert.match(html, /movePrSettings\(\)/);
  assert.match(html, /Enable PR Reviews/);
  assert.match(html, /Review debounce in seconds/);
  assert.match(html, /Use current conversation/);
  assert.match(html, /Uninstall browser/);
  assert.match(html, /installPrReviewBrowser/);
});

test('component changes remove obsolete PR browser controls and helper text at runtime', () => {
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /Install dependencies \+ Chromium/);
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /installWithDependencies\.remove\(\)/);
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /currentGlobal\.remove\(\)/);
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /warning\.remove\(\)/);
  assert.match(COMPONENT_CHANGES_UI_SCRIPT, /Math\.round\(Number\(input\.value \|\| 0\) \* 1000\)/);
});

test('browser dependency installation is selected from the server environment', () => {
  assert.equal(shouldInstallSystemBrowserDependencies({ browser: { library: { modulePath: 'C:\\project\\node_modules\\playwright-core' } } }), false);
  assert.equal(shouldInstallSystemBrowserDependencies({ browser: { library: { modulePath: '/Users/julie/project/node_modules/playwright-core' } } }), false);
  assert.equal(shouldInstallSystemBrowserDependencies({ browser: { library: { modulePath: '/home/julie/project/node_modules/playwright-core' } } }), true);
  assert.equal(shouldInstallSystemBrowserDependencies({}, 'Paseo CLI C:\\Programs\\Paseo\\paseo.cmd'), false);
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
