import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  enhanceSetupWizardWithNavigationPolish,
  SETUP_NAVIGATION_POLISH_SCRIPT,
} from '../../src/setup-wizard/navigation-polish-ui.mjs';
import { enhanceSetupWizardWithSimplifiedFlow } from '../../src/setup-wizard/simplified-flow-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

const PAGE_IDS = ['paseo', 'harness', 'repository', 'issues', 'review', 'readiness'];

function page(completed, selections = {}) {
  return { completed, selections };
}

function runScript({ pathname = '/setup', pages, visiblePage = 'paseo' }) {
  let clickHandler = null;
  const session = { currentPage: 'review', pages };
  const renders = [];
  const context = {
    PAGE_IDS,
    visiblePage,
    location: { pathname },
    active: () => session,
    permitted: () => false,
    nearestPermitted: () => 'paseo',
    render: () => { renders.push(context.visiblePage); },
    refreshPaseo: () => {},
    document: {
      addEventListener(type, handler, capture) {
        if (type === 'click' && capture === true) clickHandler = handler;
      },
    },
  };
  vm.runInNewContext(SETUP_NAVIGATION_POLISH_SCRIPT, context);
  return { context, session, renders, clickHandler };
}

function clickEvent(button) {
  let prevented = false;
  let stopped = false;
  return {
    target: { closest: () => button },
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
    state() { return { prevented, stopped }; },
  };
}

test('plain /setup resumes at the first page that still needs action', () => {
  const { context } = runScript({
    pages: {
      paseo: page(true),
      harness: page(true),
      repository: page(true),
      issues: page(false, { mode: 'recommended-labels' }),
      review: page(false, { workflow: 'quick-manual' }),
      readiness: page(false),
    },
  });
  assert.equal(context.nearestPermitted('paseo'), 'issues');
});

test('an explicit permitted setup page remains directly reloadable', () => {
  const { context } = runScript({
    pathname: '/setup/paseo',
    pages: {
      paseo: page(true),
      harness: page(true),
      repository: page(true),
      issues: page(false),
      review: page(false),
      readiness: page(false),
    },
  });
  assert.equal(context.nearestPermitted('paseo'), 'paseo');
});

test('Continue advances from the page on screen instead of the saved server currentPage', () => {
  const { context, renders, clickHandler } = runScript({
    pathname: '/setup/paseo',
    visiblePage: 'paseo',
    pages: Object.fromEntries(PAGE_IDS.map((id) => [id, page(true)])),
  });
  assert.equal(typeof clickHandler, 'function');
  const event = clickEvent({ id: 'continue', disabled: false });
  clickHandler(event);
  assert.equal(context.visiblePage, 'harness');
  assert.deepEqual(renders, ['harness']);
  assert.deepEqual(event.state(), { prevented: true, stopped: true });
});

test('Back is also relative to the page on screen and final Continue remains owned by completion', () => {
  const { context, clickHandler } = runScript({
    pathname: '/setup/issues',
    visiblePage: 'issues',
    pages: Object.fromEntries(PAGE_IDS.map((id) => [id, page(true)])),
  });
  const back = clickEvent({ id: 'back', disabled: false });
  clickHandler(back);
  assert.equal(context.visiblePage, 'repository');
  assert.deepEqual(back.state(), { prevented: true, stopped: true });

  context.visiblePage = 'readiness';
  const finish = clickEvent({ id: 'continue', disabled: false });
  clickHandler(finish);
  assert.deepEqual(finish.state(), { prevented: false, stopped: false });
});

test('navigation polish is appended after the simplified setup flow', () => {
  const base = setupWizardHtml();
  const enhanced = enhanceSetupWizardWithSimplifiedFlow(base);
  assert.match(enhanced, /data-setup-simplified-flow/);
  assert.match(enhanced, /data-setup-navigation-polish/);
  assert.ok(enhanced.indexOf('data-setup-simplified-flow') < enhanced.indexOf('data-setup-navigation-polish'));

  const direct = enhanceSetupWizardWithNavigationPolish(base);
  assert.equal((direct.match(/data-setup-navigation-polish/g) || []).length, 1);
});
