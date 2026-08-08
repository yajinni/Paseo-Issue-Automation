import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { MANAGER_AUTOMATION_REVIEWS_SCRIPT } from '../src/manager-automation-reviews-ui.mjs';
import { MANAGER_CONFIG_INTEGRATION_SCRIPT } from '../src/manager-config-integration-maintenance-ui.mjs';
import { MANAGER_CONFIGURATION_TABS_SCRIPT } from '../src/manager-configuration-tabs-ui.mjs';
import { MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT } from '../src/manager-issue-processing-flow-ui.mjs';
import { MANAGER_ISSUES_PR_REVIEWS_SCRIPT } from '../src/manager-issues-pr-reviews-ui.mjs';
import { MANAGER_NAVIGATION_SCRIPT } from '../src/manager-navigation-ui.mjs';
import { MANAGER_STATUS_EVENTS_SCRIPT } from '../src/manager-status-events-ui.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT } from '../src/manager-work-queue-ui.mjs';

const CONSUMERS = [
  ['navigation', MANAGER_NAVIGATION_SCRIPT],
  ['work-queue', MANAGER_WORK_QUEUE_SCRIPT],
  ['automation-reviews', MANAGER_AUTOMATION_REVIEWS_SCRIPT],
  ['config-integration', MANAGER_CONFIG_INTEGRATION_SCRIPT],
  ['configuration-tabs', MANAGER_CONFIGURATION_TABS_SCRIPT],
  ['issues-pr-reviews', MANAGER_ISSUES_PR_REVIEWS_SCRIPT],
  ['issue-processing-flow', MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT],
];

function compositionHarness() {
  const calls = [];
  const events = [];
  const repositorySelect = { value: 'repo-a' };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  class Event {
    constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles === true; }
  }
  const document = {
    readyState: 'loading',
    body: { classList: { add() {}, remove() {}, contains() { return false; } } },
    getElementById(id) { return id === 'repository-select' ? repositorySelect : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); return true; },
  };
  const window = {
    renderStatus(data) {
      calls.push('base:' + data.id);
      return 'base-result:' + data.id;
    },
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    document,
    CustomEvent,
    Event,
    localStorage: { getItem() { return null; }, setItem() {} },
    queueMicrotask() {},
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    console: { error() {} },
  });
  vm.runInContext(MANAGER_STATUS_EVENTS_SCRIPT, context);
  return { context, window, calls, events };
}

test('all composed manager consumers register once without replacing the status dispatcher', () => {
  const { context, window } = compositionHarness();
  const dispatcher = window.renderStatus;
  const originalAdd = window.addManagerStatusListener;
  const registrations = [];
  let currentConsumer = null;

  window.addManagerStatusListener = (listener) => {
    assert.equal(typeof listener, 'function');
    registrations.push(currentConsumer);
    return originalAdd(listener);
  };

  for (const [name, script] of CONSUMERS) {
    currentConsumer = name;
    vm.runInContext(script, context);
    assert.equal(window.renderStatus, dispatcher, name + ' must not replace the shared dispatcher');
  }

  assert.deepEqual(registrations, CONSUMERS.map(([name]) => name));
});

test('one composed status dispatch reaches every registered consumer exactly once', () => {
  const { context, window, calls, events } = compositionHarness();
  const originalAdd = window.addManagerStatusListener;
  const hits = new Map(CONSUMERS.map(([name]) => [name, 0]));
  let currentConsumer = null;

  window.addManagerStatusListener = (listener) => {
    assert.equal(typeof listener, 'function');
    const name = currentConsumer;
    return originalAdd(() => hits.set(name, hits.get(name) + 1));
  };

  for (const [name, script] of CONSUMERS) {
    currentConsumer = name;
    vm.runInContext(script, context);
  }

  assert.equal(window.renderStatus({ id: 77, repository: { id: 'repo-a' } }), 'base-result:77');
  assert.deepEqual(calls, ['base:77']);
  for (const [name] of CONSUMERS) assert.equal(hits.get(name), 1, name + ' should receive one status update');
  assert.equal(events.filter((event) => event.type === 'paseo:manager-status').length, 1);
});
