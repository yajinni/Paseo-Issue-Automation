import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { PR_REVIEW_BROWSER_SETUP_UI_SCRIPT } from '../src/pr-review-browser-setup-ui-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

function fakeNode() {
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    hidden: false,
    title: '',
    value: '',
    dataset: {},
    oninput: null,
    onclick: null,
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
}

function browserUiHarness(fetchImpl) {
  const ids = [
    'pr-chromium-status', 'pr-chat-url-status', 'pr-install-chromium', 'pr-sign-in-browser',
    'pr-test-browser', 'pr-browser-test-result', 'pr-chromium-badge', 'pr-chat-url-badge',
    'pr-browser-chip', 'pr-conversation-chip', 'pr-project-url',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, fakeNode()]));
  const refreshes = [];
  const posts = [];
  const toasts = [];
  const window = {
    latestData: null,
    refreshPrReviews(force) {
      refreshes.push(force);
      return Promise.resolve(window.latestData);
    },
    prReviewPost(path, body) {
      posts.push({ path, body });
      return Promise.resolve({});
    },
  };
  const context = {
    window,
    document: {
      getElementById(id) { return nodes[id] || null; },
      createElement() { return fakeNode(); },
    },
    fetch: fetchImpl,
    toast(message, bad) { toasts.push({ message, bad: bad === true }); },
    JSON,
    Promise,
    String,
    Error,
  };
  vm.runInNewContext(PR_REVIEW_BROWSER_SETUP_UI_SCRIPT, context);
  return { context, window, nodes, refreshes, posts, toasts };
}

function readyData(url = 'https://chatgpt.com/c/project-review') {
  return {
    config: { browserReview: { projectConversationUrl: url } },
    browser: {
      chromium: { installed: true },
      profile: { locked: false, lastAuthenticatedAt: null },
    },
  };
}

test('generated dashboard exposes the simplified setup, safe sign-in path, and GitHub Issues wording', () => {
  const html = dashboardHtml();
  assert.match(html, /PR Review Chat URL/);
  assert.match(html, /id="pr-project-url"/);
  assert.match(html, /projectConversationUrl/);
  assert.match(html, /Chromium Installed/);
  assert.match(html, /id="pr-test-browser"[^>]*>Test</);
  assert.match(html, /id="pr-install-chromium"/);
  assert.match(html, /pr-sign-in-browser/);
  assert.match(html, /Sign in to ChatGPT/);
  assert.match(html, /\/api\/pr-reviews\/browser\/open/);
  assert.match(html, /Reset profile/);
  assert.match(html, /Uninstall Chromium/);

  for (const removed of [
    />Launch browser</,
    />Use current conversation</,
    />Test destination</,
    />Send harmless test</,
    />Close browser</,
    /Project conversation URL/,
    /Library: <strong>/,
    /Profile lock: <strong>/,
    /GPT Chat Selected:/,
    /Global conversation: <strong>/,
    /health-dependencies/,
    /Native dependencies available/,
    /Native dependency API/,
    /Structured GitHub blocked-by data is available\./,
  ]) assert.doesNotMatch(html, removed);

  assert.match(html, /GitHub Issues API/);
  assert.match(html, /GitHub issue's structure read and accessible\./);
  assert.match(html, /GitHub issue structure or blocked-by relationships are unavailable\./);
  assert.match(html, /browser\.chromium\.installed/);
  assert.doesNotMatch(html, /browser\.library\.installed/);
});

test('browser requirements use actual Chromium and only the saved project chat URL', () => {
  const harness = browserUiHarness(async () => { throw new Error('unexpected fetch'); });
  const data = readyData(null);
  data.globalConversationUrl = 'https://chatgpt.com/c/global-fallback';
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);

  assert.equal(harness.nodes['pr-chromium-status'].textContent, 'Installed');
  assert.equal(harness.nodes['pr-chat-url-status'].textContent, 'Missing');
  assert.equal(harness.nodes['pr-test-browser'].disabled, true);
  assert.equal(harness.nodes['pr-sign-in-browser'].disabled, false);
  assert.match(harness.nodes['pr-conversation-chip'].textContent, /missing/i);

  data.config.browserReview.projectConversationUrl = 'https://chatgpt.com/c/project-review';
  harness.window.renderPrReviewBrowserSetup(data);
  assert.equal(harness.nodes['pr-chat-url-status'].textContent, 'Configured');
  assert.equal(harness.nodes['pr-test-browser'].disabled, false);
  assert.equal(harness.nodes['pr-install-chromium'].classList.contains('hidden'), true);
});

test('Sign in opens the persistent Chromium profile at the saved project URL', async () => {
  const calls = [];
  const harness = browserUiHarness(async (path, options) => {
    calls.push({ path, options });
    return { ok: true, text: async () => JSON.stringify({ opened: true }) };
  });
  const data = readyData();
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);

  const result = await harness.window.openPrReviewBrowserForLogin();
  assert.deepEqual(result, { opened: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/pr-reviews/browser/open');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: 'https://chatgpt.com/c/project-review',
  });
  assert.equal(harness.nodes['pr-sign-in-browser'].disabled, true);
  assert.equal(harness.nodes['pr-test-browser'].disabled, true);
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /Complete sign-in, close the browser, then run Test/);

  data.browser.profile.locked = true;
  harness.window.renderPrReviewBrowserSetup(data);
  data.browser.profile.locked = false;
  harness.window.renderPrReviewBrowserSetup(data);
  assert.equal(harness.nodes['pr-sign-in-browser'].disabled, false);
  assert.equal(harness.nodes['pr-test-browser'].disabled, false);
});

test('Test launches the saved PR Review Chat URL visibly without sending a message or duplicating requests', async () => {
  let release;
  const calls = [];
  const responsePromise = new Promise((resolve) => { release = resolve; });
  const harness = browserUiHarness((path, options) => {
    calls.push({ path, options });
    return responsePromise;
  });
  const data = readyData();
  harness.nodes['pr-project-url'].value = data.config.browserReview.projectConversationUrl;
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);

  const first = harness.window.testPrReviewBrowserSetup();
  const duplicate = await harness.window.testPrReviewBrowserSetup();
  assert.equal(duplicate, null);
  assert.equal(calls.length, 1);
  assert.equal(harness.nodes['pr-test-browser'].disabled, true);
  assert.equal(harness.nodes['pr-test-browser'].textContent, 'Testing…');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].path, '/api/pr-reviews/browser/test');
  assert.deepEqual(body, {
    url: 'https://chatgpt.com/c/project-review',
    visible: true,
    sendTestPrompt: false,
  });

  release({ ok: true, text: async () => JSON.stringify({ result: { ok: true } }) });
  await first;
  assert.equal(harness.nodes['pr-test-browser'].disabled, false);
  assert.equal(harness.nodes['pr-test-browser'].textContent, 'Test');
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /No message was sent/);
  assert.equal(harness.nodes['pr-project-url'].value, 'https://chatgpt.com/c/project-review');
});

test('test results clear when the saved URL or Chromium readiness changes', async () => {
  const harness = browserUiHarness(async () => ({
    ok: true,
    text: async () => JSON.stringify({ result: { ok: true } }),
  }));
  const data = readyData();
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);
  await harness.window.testPrReviewBrowserSetup();
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /verified/);

  data.config.browserReview.projectConversationUrl = 'https://chatgpt.com/c/different-review';
  harness.window.renderPrReviewBrowserSetup(data);
  assert.equal(harness.nodes['pr-browser-test-result'].textContent, '');

  await harness.window.testPrReviewBrowserSetup();
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /verified/);
  data.browser.chromium.installed = false;
  harness.window.renderPrReviewBrowserSetup(data);
  assert.equal(harness.nodes['pr-browser-test-result'].textContent, '');
});

test('editing the URL or resetting the profile clears a displayed test result', async () => {
  const harness = browserUiHarness(async () => ({
    ok: true,
    text: async () => JSON.stringify({ result: { ok: true } }),
  }));
  const data = readyData();
  harness.nodes['pr-project-url'].value = data.config.browserReview.projectConversationUrl;
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);
  await harness.window.testPrReviewBrowserSetup();
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /verified/);

  harness.nodes['pr-project-url'].value = 'https://chatgpt.com/c/unsaved-change';
  harness.nodes['pr-project-url'].oninput();
  assert.equal(harness.nodes['pr-browser-test-result'].textContent, '');

  harness.nodes['pr-project-url'].value = data.config.browserReview.projectConversationUrl;
  await harness.window.testPrReviewBrowserSetup();
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /verified/);
  await harness.window.prReviewPost('/api/pr-reviews/browser/reset');
  assert.equal(harness.nodes['pr-browser-test-result'].textContent, '');
  assert.equal(harness.posts.at(-1).path, '/api/pr-reviews/browser/reset');
});

test('failed Test restores controls and preserves the saved URL', async () => {
  const harness = browserUiHarness(async () => ({
    ok: false,
    text: async () => JSON.stringify({ error: 'ChatGPT redirected to login.' }),
  }));
  const data = readyData();
  harness.nodes['pr-project-url'].value = data.config.browserReview.projectConversationUrl;
  harness.window.latestData = data;
  harness.window.renderPrReviewBrowserSetup(data);

  const result = await harness.window.testPrReviewBrowserSetup();
  assert.equal(result, null);
  assert.equal(harness.nodes['pr-test-browser'].disabled, false);
  assert.match(harness.nodes['pr-browser-test-result'].textContent, /redirected to login/);
  assert.equal(harness.nodes['pr-project-url'].value, 'https://chatgpt.com/c/project-review');
  assert.equal(harness.toasts.at(-1).bad, true);
});
