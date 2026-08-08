import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
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
  const dispatchResult = { textContent: 'No dispatch has been recorded.' };
  const document = {
    readyState: 'loading',
    getElementById(id) {
      if (id === 'repository-select') return repositorySelect;
      if (id === 'dispatch-result') return dispatchResult;
      return null;
    },
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
    window, calls, errors, events, microtasks, domListeners, dispatchResult,
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

test('multiple direct status listeners run once after one base render', () => {
  const { window, calls, events } = statusHarness();
  const removeFirst = window.addManagerStatusListener((data) => calls.push('first:' + data.id));
  window.addManagerStatusListener((data) => calls.push('second:' + data.id));

  const result = window.renderStatus({ id: 7 });
  assert.equal(result, 'base-result:7');
  assert.deepEqual(calls, ['base:7', 'first:7', 'second:7']);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 1);
  assert.equal(events.find((event) => event.type === 'paseo:manager-status').detail.id, 7);

  removeFirst();
  calls.length = 0;
  window.renderStatus({ id: 8 });
  assert.deepEqual(calls, ['base:8', 'second:8']);
});

test('stale repository status is rejected before base rendering or listeners run', () => {
  const { window, calls, events } = statusHarness({ selectedRepositoryId: 'repo-b' });
  window.addManagerStatusListener((data) => calls.push('listener:' + data.id));

  assert.equal(window.renderStatus({ id: 10, repository: { id: 'repo-a' } }), undefined);
  assert.deepEqual(calls, []);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 0);

  assert.equal(window.renderStatus({ id: 11, repository: { id: 'repo-b' } }), 'base-result:11');
  assert.deepEqual(calls, ['base:11', 'listener:11']);
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 1);
});

test('late action response restores the latest accepted status and scopes feedback to the previous repository', async () => {
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
  const body = await action;
  assert.equal(body.result.ok, true);
  assert.equal(body.result.message, 'Action completed for the previously selected repository after you switched repositories.');
  assert.deepEqual(harness.calls, ['post:run-now', 'base:21']);
  assert.equal(harness.events.filter((event) => event.type === 'paseo:manager-status').length, 1);
  assert.equal(harness.events.find((event) => event.type === 'paseo:manager-status').detail.id, 21);
});

test('stale action response clears old action result and scopes feedback when the new status is not loaded yet', async () => {
  const harness = statusHarness({ selectedRepositoryId: 'repo-a' });
  harness.window.renderStatus({ id: 30, repository: { id: 'repo-a' } });
  harness.calls.length = 0;

  const action = harness.window.postRepositoryAction('pause');
  harness.setSelectedRepositoryId('repo-b');
  harness.dispatchResult.textContent = 'repo-a action completed';
  harness.resolvePost({ result: { ok: true } });
  const body = await action;

  assert.deepEqual(harness.calls, ['post:pause']);
  assert.equal(harness.dispatchResult.textContent, 'Waiting for the selected repository status.');
  assert.equal(body.result.ok, true);
  assert.equal(body.result.message, 'Action completed for the previously selected repository after you switched repositories.');
});

test('same-repository action response keeps its original feedback and does not trigger a redundant status render', async () => {
  const harness = statusHarness({ selectedRepositoryId: 'repo-a' });
  harness.window.renderStatus({ id: 40, repository: { id: 'repo-a' } });
  harness.calls.length = 0;

  const action = harness.window.postRepositoryAction('pause');
  harness.resolvePost({ result: { ok: true } });
  const body = await action;

  assert.deepEqual(body, { result: { ok: true } });
  assert.deepEqual(harness.calls, ['post:pause']);
});

test('one failing listener does not prevent later manager UI listeners', () => {
  const { window, calls, errors } = statusHarness();
  window.addManagerStatusListener(() => { throw new Error('broken listener'); });
  window.addManagerStatusListener((data) => calls.push('healthy:' + data.id));

  assert.equal(window.renderStatus({ id: 9 }), 'base-result:9');
  assert.deepEqual(calls, ['base:9', 'healthy:9']);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /listener failed/i);
});

test('recursive listener render returns the active base result without redispatching listeners', () => {
  const { window, calls } = statusHarness();
  window.addManagerStatusListener((data) => {
    calls.push('listener:' + data.id);
    calls.push('recursive:' + window.renderStatus({ id: 99 }));
  });

  assert.equal(window.renderStatus({ id: 12 }), 'base-result:12');
  assert.deepEqual(calls, ['base:12', 'listener:12', 'recursive:base-result:12']);
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

test('status event enhancer injects without legacy capture compatibility', () => {
  const source = '<html><head></head><body><main>manager</main></body></html>';
  const html = enhanceManagerWithStatusEvents(source);
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-status-events/);
  assert.match(html, /addManagerStatusListener/);
  assert.doesNotMatch(html, /data-manager-status-capture/);
  assert.doesNotMatch(html, /captureManagerStatusRenderer/);
  assert.doesNotMatch(html, /capturedRenderers/);
  assert.doesNotMatch(html, /Object\.defineProperty\(window, 'renderStatus'/);
  assert.ok(html.indexOf('data-manager-status-events') < html.indexOf('</body>'));
});
