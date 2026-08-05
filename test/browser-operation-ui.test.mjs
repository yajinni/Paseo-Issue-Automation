import assert from 'node:assert/strict';
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

function createHarness() {
  const document = new FakeDocument();
  const uninstallButton = document.createElement('button');
  uninstallButton.id = 'uninstall-control';
  uninstallButton.textContent = 'Uninstall browser';
  uninstallButton.setAttribute('onclick', "openPrReviewConfirm('Uninstall browser')");
  document.body.appendChild(uninstallButton);

  const fetchCalls = [];
  let resolveFetch;
  const fetch = (path, options) => {
    fetchCalls.push({ path, options });
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
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
    resolveFetch(response) { resolveFetch(response); },
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

test('Chromium install uses a compact auto-closing status panel', () => {
  const html = dashboardHtml();
  assert.match(html, /browser-operation-panel/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /showModal\(/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /\.show\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /\.close\(\)/);
  assert.doesNotMatch(BROWSER_OPERATION_UI_SCRIPT, /pr-confirm-dialog/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /aria-modal', 'false'/);
  assert.match(BROWSER_OPERATION_UI_SCRIPT, /Expected install time: 30–60 seconds\./);
});

test('uninstall confirmation stays visible without making the dashboard inert', async () => {
  const harness = createHarness();

  harness.uninstallButton.click();
  const confirmation = harness.document.getElementById('browser-uninstall-confirm');
  const input = harness.document.getElementById('browser-uninstall-input');
  const confirm = harness.document.getElementById('browser-uninstall-confirm-button');

  assert.equal(harness.uninstallButton.textContent, 'Uninstall Chromium');
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

  harness.resolveFetch({ ok: true, text: async () => '{"ok":true}' });
  await settle();

  assert.equal(progress.hidden, true);
  assert.equal(harness.toasts.at(-1).message, 'Chromium and dedicated browser state removed and verified.');
});

test('dashboard refresh callers share the same in-flight setup snapshot promise', () => {
  assert.match(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return pollInFlight/);
  assert.match(DASHBOARD_POLL_SCRIPT, /pollInFlight = \(async function\(\)/);
  assert.doesNotMatch(DASHBOARD_POLL_SCRIPT, /if \(pollInFlight\) return dashboardData/);
});
