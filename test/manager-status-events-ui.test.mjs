import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  enhanceManagerWithStatusEvents,
  MANAGER_STATUS_EVENTS_SCRIPT,
} from '../src/manager-status-events-ui.mjs';

function statusHarness() {
  const calls = [];
  const errors = [];
  const events = [];
  const microtasks = [];
  const domListeners = new Map();
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const document = {
    readyState: 'loading',
    addEventListener(type, listener) { domListeners.set(type, listener); },
    dispatchEvent(event) { events.push(event); return true; },
  };
  const window = {
    renderStatus(data) {
      calls.push('base:' + data.id);
      return 'base-result:' + data.id;
    },
  };
  vm.runInNewContext(MANAGER_STATUS_EVENTS_SCRIPT, {
    window,
    document,
    CustomEvent,
    queueMicrotask: (callback) => microtasks.push(callback),
    console: { error: (...args) => errors.push(args) },
    Set,
    TypeError,
  });
  return { window, calls, errors, events, microtasks, domListeners };
}

test('legacy renderStatus wrappers become independent subscribers and base rendering runs once', () => {
  const { window, calls, events } = statusHarness();
  const firstPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = firstPrevious(data);
    calls.push('first:' + data.id);
    return result;
  };
  const secondPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = secondPrevious(data);
    calls.push('second:' + data.id);
    return result;
  };
  const remove = window.addManagerStatusListener((data) => calls.push('listener:' + data.id));

  const result = window.renderStatus({ id: 7 });
  assert.equal(result, 'base-result:7');
  assert.deepEqual(calls, ['base:7', 'first:7', 'second:7', 'listener:7']);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 1);
  assert.equal(events.find((event) => event.type === 'paseo:manager-status').detail.id, 7);

  remove();
  calls.length = 0;
  window.renderStatus({ id: 8 });
  assert.deepEqual(calls, ['base:8', 'first:8', 'second:8']);
});

test('one failing status subscriber does not prevent later manager UI subscribers', () => {
  const { window, calls, errors } = statusHarness();
  const brokenPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    brokenPrevious(data);
    throw new Error('broken subscriber');
  };
  const healthyPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = healthyPrevious(data);
    calls.push('healthy:' + data.id);
    return result;
  };

  assert.equal(window.renderStatus({ id: 9 }), 'base-result:9');
  assert.deepEqual(calls, ['base:9', 'healthy:9']);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /subscriber failed/i);
});

test('status hub announces a stable manager UI ready lifecycle event', () => {
  const { domListeners, microtasks, events } = statusHarness();
  const ready = domListeners.get('DOMContentLoaded');
  assert.equal(typeof ready, 'function');
  ready();
  assert.equal(microtasks.length, 1);
  microtasks.shift()();
  assert.ok(events.some((event) => event.type === 'paseo:manager-ui-ready'));
});

test('status event enhancer injects the compatibility hub without replacing manager markup', () => {
  const html = enhanceManagerWithStatusEvents('<html><head></head><body><main>manager</main></body></html>');
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-status-events/);
  assert.match(html, /addManagerStatusListener/);
  assert.ok(html.indexOf('data-manager-status-events') < html.indexOf('</body>'));
});
