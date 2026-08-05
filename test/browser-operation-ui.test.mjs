import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { BROWSER_OPERATION_UI_SCRIPT } from '../src/browser-operation-ui-script.mjs';
import { DASHBOARD_POLL_SCRIPT } from '../src/dashboard-poll-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.onclick = null;
    this.oninput = null;
    this.type = '';
    this.title = '';
    this.inert = false;
    this._id = '';
    this._innerHTML = '';
  }

  set id(value) {
    this._id = String(value);
    this.ownerDocument.register(this);
  }

  get id() {
    return this._id;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    const expression = /<([a-z0-9-]+)([^>]*\sid="([^"]+)"[^>]*)>/gi;
    let match;
    while ((match = expression.exec(this._innerHTML))) {
      const child = new FakeElement(match[1], this.ownerDocument);
      child.id = match[3];
      child.hidden = /\shidden(?:\s|>|$)/i.test(match[2]);
      child.disabled = /\sdisabled(?:\s|>|$)/i.test(match[2]);
      this.children.push(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    this.ownerDocument.register(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
    if (name === 'onclick') this.onclick = null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatchEvent(type) {
    for (const handler of this.listeners.get(type) || []) handler({ target: this });
  }

  click() {
    if (this.disabled) return;
    const event = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    if (typeof this.onclick === 'function') this.onclick(event);
    for (const handler of this.listeners.get('click') || []) handler(event);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.readyState = 'complete';
    this.activeElement = null;
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.body.inert = false;
  }

  register(element) {
    if (element.id) this.elements.set(element.id, element);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  querySelectorAll(selector) {
    const tagName = String(selector).toUpperCase();
    return [this.head, this.body, ...this.elements.values()].filter((element, index, values) => (
      element.tagName === tagName && values.indexOf(element) === index
    ));
  }

  addEventListener() {}
}

function uninstallMarkup() {
  const html = dashboardHtml();
  const match = html.match(/<button class="danger" onclick="([^"]*\/api\/pr-reviews\/browser\/uninstall[^"]*)">Uninstall browser<\/button>/);
  assert.ok(match, 'the integrated dashboard must expose the expected uninstall endpoint');
  return match[1];
}

function createHarness() {
  const document = new FakeDocument();
  const uninstallButton = document.createElement('button');
  uninstallButton.id = 'uninstall-control';
  uninstallButton.textContent = 'Uninstall browser';
  uninstallButton.setAttribute('onclick', uninstallMarkup());
  document.body.appendChild(uninstallButton);

  const fetchCalls = [];
  const pendingFetches = [];
  const fetch = (path, options) => {
    fetchCalls.push({ path, options });
    return new Promise((resolve) => pendingFetches.push(resolve));
  };
  const toasts = [];
  const window = {};
  const context = {
    window,
    document,
    fetch,
    toast(message, bad) { toasts.push({ message, bad: Boolean(bad) }); },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(BROWSER_OPERATION_UI_SCRIPT, context);
  return {
    document,
    fetchCalls,
    resolveNextFetch(response) {
      const resolve = pendingFetches.shift();
      assert.ok(resolve, 'a browser operation request must be pending');
      resolve(response);
    },
    toasts,
    uninstallButton,
    window,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function startConfirmedUninstall(harness) {
  harness.uninstallButton.click();
  const confirmation = harness.document.getElementById('browser-uninstall-confirm');
  const input = harness.document.getElementById('browser-uninstall-input');
  const confirm = harness.document.getElementById('browser-uninstall-confirm-button');
  input.value = 'UNINSTALL';
  input.oninput();
  confirm.click();
  return {
    confirmation,
    input,
    confirm,
    progress: harness.document.getElementById('browser-operation-panel'),
  };
}

test('Chromium controls use fixed non-modal panels and are included in changed-area checks', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.check, /node --check src\/browser-operation-ui-script\.mjs/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /showModal\(/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /\.show\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /\.close\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /pr-confirm-dialog/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /setTimeout\(function\(\) \{\s*runBrowserOperation\(UNINSTALL_PATH\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /inlineAction\.includes\('\/api\/pr-reviews\/browser\/uninstall'\)/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Expected install time: 30–60 seconds\./);
});

test('uninstall confirmation uses the real dashboard endpoint without making the page inert', async () => {
  const harness = createHarness();

  harness.uninstallButton.click();
  const confirmation = harness.document.getElementById('browser-uninstall-confirm');
  const input = harness.document.getElementById('browser-uninstall-input');
  const confirm = harness.document.getElementById('browser-uninstall-confirm-button');

  assert.equal(harness.uninstallButton.id, 'pr-uninstall-chromium');
  assert.equal(harness.uninstallButton.textContent, 'Uninstall Chromium');
  assert.equal(harness.uninstallButton.getAttribute('onclick'), null);
  assert.equal(harness.uninstallButton.getAttribute('aria-controls'), 'browser-uninstall-confirm');
  assert.equal(confirmation.hidden, false);
  assert.equal(harness.document.body.inert, false);
  assert.equal(harness.document.querySelectorAll('dialog').length, 0);
  assert.equal(harness.document.activeElement, input);

  input.value = 'UNINSTALL';
  input.oninput();
  assert.equal(confirm.disabled, false);
  confirm.click();

  const progress = harness.document.getElementById('browser-operation-panel');
  assert.equal(confirmation.hidden, true);
  assert.equal(progress.hidden, false);
  assert.equal(harness.document.body.inert, false);
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].path, '/api/pr-reviews/browser/uninstall');

  harness.window.installPrReviewBrowser();
  assert.equal(harness.fetchCalls.length, 1, 'a second Chromium command must not start while uninstall is pending');
  assert.equal(harness.toasts.at(-1).message, 'A Chromium install or uninstall command is already running.');

  harness.resolveNextFetch({ ok: true, text: async () => '{"ok":true}' });
  await settle();

  assert.equal(progress.hidden, true);
  assert.equal(harness.document.activeElement, harness.uninstallButton);
  assert.equal(harness.toasts.at(-1).message, 'Chromium and dedicated browser state removed and verified.');
});

test('cancel restores focus without leaking that trigger into a later install', async () => {
  const harness = createHarness();
  harness.uninstallButton.click();
  const confirmation = harness.document.getElementById('browser-uninstall-confirm');
  const cancel = harness.document.getElementById('browser-uninstall-cancel');

  cancel.click();

  assert.equal(confirmation.hidden, true);
  assert.equal(harness.document.activeElement, harness.uninstallButton);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.document.body.inert, false);

  const installTrigger = harness.document.createElement('button');
  installTrigger.focus();
  harness.window.installPrReviewBrowser();
  harness.resolveNextFetch({ ok: true, text: async () => '{"ok":true}' });
  await settle();

  assert.equal(harness.document.activeElement, installTrigger, 'a completed install must not focus the old uninstall button');
});

test('uninstall failure remains visible, releases the lock, and can be retried safely', async () => {
  const harness = createHarness();
  const { progress } = startConfirmedUninstall(harness);
  harness.resolveNextFetch({
    ok: false,
    text: async () => '{"error":"Close the dedicated ChatGPT browser before uninstalling Chromium."}',
  });
  await settle();

  const error = harness.document.getElementById('browser-operation-error');
  const close = harness.document.getElementById('browser-operation-close');
  assert.equal(progress.hidden, false);
  assert.equal(progress.dataset.state, 'failed');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Close the dedicated ChatGPT browser before uninstalling Chromium.');
  assert.equal(close.hidden, false);
  assert.equal(harness.document.activeElement, close);
  assert.equal(harness.document.body.inert, false);

  harness.uninstallButton.click();
  const confirmation = harness.document.getElementById('browser-uninstall-confirm');
  const input = harness.document.getElementById('browser-uninstall-input');
  const cancel = harness.document.getElementById('browser-uninstall-cancel');
  assert.equal(progress.hidden, true, 'retry must dismiss the prior error panel');
  assert.equal(confirmation.hidden, false, 'retry confirmation must be visible above the cleared error state');
  assert.equal(harness.document.activeElement, input);

  cancel.click();
  assert.equal(confirmation.hidden, true);
  assert.equal(harness.document.activeElement, harness.uninstallButton);

  harness.window.installPrReviewBrowser();
  assert.equal(harness.fetchCalls.length, 2, 'the operation lock must be released after failure');
  assert.equal(harness.fetchCalls[1].path, '/api/pr-reviews/browser/install');
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
