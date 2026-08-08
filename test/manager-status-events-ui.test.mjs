import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  captureManagerStatusRenderer,
  enhanceManagerWithStatusEvents,
  MANAGER_STATUS_EVENTS_SCRIPT,
} from '../src/manager-status-events-ui.mjs';

function statusHarness({ selectedRepositoryId: initialRepositoryId = null } = {}) {
  const calls = [];
  const errors = [];
  const events = [];
  const microtasks = [];
  const domListeners = new Map();
  let selectedRepositoryId = initialRepositoryId;
  let pendingPost = null;
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const repositorySelect = {
    get value() { return selectedRepositoryId || ''; },
  };
  const document = {
    readyState: 'loading',
    getElementById(id) { return id === 'repository-select' ? repositorySelect : null; },
    addEventListener(type, listener) { domListeners.set(type, listener); },
    dispatchEvent(event) { events.push(event); return true; },
  };
  const window = {
    renderStatus(data) {
      calls.push('base:' + data.id);
      return 'base-result:' + data.id;
    },
    postRepositoryAction(action) {
      return new Promise((resolve, reject) => { pendingPost = { action, resolve, reject }; });
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
  return {
    window, calls, errors, events, microtasks, domListeners,
    setSelectedRepositoryId(value) { selectedRepositoryId = value; },
    resolvePost(body) {
      assert.ok(pendingPost, 'a repository action should be pending');
      calls.push('post:' + pendingPost.action);
      const { resolve } = pendingPost;
      pendingPost = null;
      resolve(body);
    },
  };
}

test('captured renderStatus wrappers become independent subscribers and base rendering runs once', () => {
  const { window, calls, events } = statusHarness();
  const firstPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = firstPrevious(data);
    calls.push('first:' + data.id);
    return result;
  };
  assert.equal(window.captureManagerStatusRenderer(), true);

  const secondPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = secondPrevious(data);
    calls.push('second:' + data.id);
    return result;
  };
  assert.equal(window.captureManagerStatusRenderer(), true);

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

test('stale repository status is rejected before base rendering or subscribers run', () => {
  const { window, calls, events } = statusHarness({ selectedRepositoryId: 'repo-b' });
  window.addManagerStatusListener((data) => calls.push('listener:' + data.id));

  assert.equal(window.renderStatus({ id: 10, repository: { id: 'repo-a' } }), undefined);
  assert.deepEqual(calls, []);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 0);

  assert.equal(window.renderStatus({ id: 11, repository: { id: 'repo-b' } }), 'base-result:11');
  assert.deepEqual(calls, ['base:11', 'listener:11']);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 1);
});

test('late action response restores the latest accepted status for the newly selected repository', async () => {
  const harness = statusHarness({ selectedRepositoryId: 'repo-a' });
  harness.window.renderStatus({ id: 20, repository: { id: 'repo-a' } });
  harness.calls.length = 0;
  harness.events.length = 0;

  const action = harness.window.postRepositoryAction('run-now');
  harness.setSelectedRepositoryId('repo-b');
  harness.window.renderStatus({ id: 21, repository: { id: 'repo-b' } });
  harness.calls.length = 0;
  harness.events.length = 0;

  harness.resolvePost({ result: { ok: true } });
  assert.deepEqual(await action, { result: { ok: true } });
  assert.deepEqual(harness.calls, ['post:run-now', 'base:21']);
  assert.equal(harness.events.filter((event) => event.type === 'paseo:manager-status').length, 1);
  assert.equal(harness.events.find((event) => event.type === 'paseo:manager-status').detail.id, 21);
});

test('stale action response never re-renders the old repository when the new status is not loaded yet', async () => {
  const harness = statusHarness({ selectedRepositoryId: 'repo-a' });
  harness.window.renderStatus({ id: 30, repository: { id: 'repo-a' } });
  harness.calls.length = 0;

  const action = harness.window.postRepositoryAction('pause');
  harness.setSelectedRepositoryId('repo-b');
  harness.resolvePost({ result: { ok: true } });
  await action;

  assert.deepEqual(harness.calls, ['post:pause']);
});

test('same-repository action response does not trigger a redundant status render', async () => {
  const harness = statusHarness({ selectedRepositoryId: 'repo-a' });
  harness.window.renderStatus({ id: 40, repository: { id: 'repo-a' } });
  harness.calls.length = 0;

  const action = harness.window.postRepositoryAction('pause');
  harness.resolvePost({ result: { ok: true } });
  await action;

  assert.deepEqual(harness.calls, ['post:pause']);
});

test('one failing captured renderer does not prevent later manager UI renderers', () => {
  const { window, calls, errors } = statusHarness();
  const brokenPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    brokenPrevious(data);
    throw new Error('broken renderer');
  };
  window.captureManagerStatusRenderer();

  const healthyPrevious = window.renderStatus;
  window.renderStatus = (data) => {
    const result = healthyPrevious(data);
    calls.push('healthy:' + data.id);
    return result;
  };
  window.captureManagerStatusRenderer();

  assert.equal(window.renderStatus({ id: 9 }), 'base-result:9');
  assert.deepEqual(calls, ['base:9', 'healthy:9']);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /renderer failed/i);
});

test('capture boundary restores the stable dispatcher and ignores duplicate captures', () => {
  const { window } = statusHarness();
  const dispatcher = window.renderStatus;
  assert.equal(window.captureManagerStatusRenderer(), false);
  assert.equal(window.renderStatus, dispatcher);
  window.renderStatus = () => 'enhanced';
  assert.equal(window.captureManagerStatusRenderer(), true);
  assert.equal(window.renderStatus, dispatcher);
  assert.equal(window.captureManagerStatusRenderer(), false);
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

test('status event enhancer and capture boundary inject without replacing manager markup', () => {
  const source = '<html><head></head><body><main>manager</main></body></html>';
  const withHub = enhanceManagerWithStatusEvents(source);
  const html = captureManagerStatusRenderer(withHub);
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-status-events/);
  assert.match(html, /data-manager-status-capture/);
  assert.match(html, /addManagerStatusListener/);
  assert.doesNotMatch(html, /Object\.defineProperty\(window, 'renderStatus'/);
  assert.ok(html.indexOf('data-manager-status-events') < html.indexOf('data-manager-status-capture'));
  assert.ok(html.indexOf('data-manager-status-capture') < html.indexOf('</body>'));
});
