import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  enhanceManagerWithUiFoundation,
  enhanceSetupWithSharedUiTheme,
  MANAGER_LEGACY_VIEW_NORMALIZATION_SCRIPT,
  MANAGER_UI_FOUNDATION_CSS,
} from '../src/manager-ui-foundation.mjs';
import { replaceRequiredHtml } from '../src/ui-html.mjs';
import { PASEO_UI_THEME_CSS } from '../src/ui-theme.mjs';
import { setupWizardHtml } from '../src/setup-wizard/ui.mjs';

function legacyViewHarness(initialHref) {
  const location = { href: initialHref };
  const stored = new Map();
  const listeners = new Map();
  const replacements = [];
  const clicks = [];
  const history = {
    replaceState(state, _unused, url) {
      replacements.push({ state, url: String(url) });
      location.href = String(url);
    },
  };
  const document = {
    querySelector(selector) {
      return { click() { clicks.push(selector); } };
    },
  };
  const window = { addEventListener(type, listener) { listeners.set(type, listener); } };
  const localStorage = {
    setItem(key, value) { stored.set(key, String(value)); },
  };
  vm.runInNewContext(MANAGER_LEGACY_VIEW_NORMALIZATION_SCRIPT, {
    URL,
    location,
    history,
    document,
    window,
    localStorage,
    queueMicrotask: (callback) => callback(),
  });
  return { location, stored, listeners, replacements, clicks };
}

test('shared UI theme defines setup-derived design tokens and reusable control states', () => {
  assert.match(PASEO_UI_THEME_CSS, /--paseo-bg:#0d1117/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-panel:#171e28/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-card:#121923/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-primary:#2f6fed/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-selected:#243044/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-success:#2f8d55/);
  assert.match(PASEO_UI_THEME_CSS, /--paseo-danger:#b74b4b/);
  assert.match(PASEO_UI_THEME_CSS, /\.paseo-ui-button/);
  assert.match(PASEO_UI_THEME_CSS, /focus-visible/);
  assert.match(PASEO_UI_THEME_CSS, /prefers-reduced-motion:reduce/);
});

test('manager foundation applies setup visual language without replacing manager markup', () => {
  const base = '<!doctype html><html><head><style>.existing{display:block}</style></head><body><main id="manager">Keep me</main></body></html>';
  const html = enhanceManagerWithUiFoundation(base);

  assert.match(html, /data-paseo-ui-theme="manager"/);
  assert.match(html, /data-manager-ui-foundation/);
  assert.match(html, /data-manager-legacy-view-normalization/);
  assert.match(html, /<main id="manager">Keep me<\/main>/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /linear-gradient\(180deg,var\(--paseo-bg\),var\(--paseo-bg-bottom\)\)/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /\.card,\.manager-overview/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /button:not\(\.secondary\):not\(\.warning\):not\(\.danger\)/);
  assert.ok(html.indexOf('.existing{display:block}') < html.indexOf('data-manager-ui-foundation'));
});

test('legacy Integration URL is replaced with Configuration and the repository tab', () => {
  const harness = legacyViewHarness('http://127.0.0.1:4318/?view=integration');
  assert.equal(new URL(harness.location.href).searchParams.get('view'), 'configuration');
  assert.equal(harness.stored.get('paseo-manager-config-tab'), 'repository');
  assert.equal(harness.replacements.length, 1);
  assert.equal(harness.replacements[0].state.managerView, 'configuration');
  assert.ok(harness.clicks.some((selector) => selector.includes('data-config-tab="repository"')));
});

test('legacy Maintenance history entries normalize on popstate without pushing history', () => {
  const harness = legacyViewHarness('http://127.0.0.1:4318/?view=overview');
  assert.equal(harness.replacements.length, 0);
  harness.location.href = 'http://127.0.0.1:4318/?view=maintenance';
  harness.listeners.get('popstate')();
  assert.equal(new URL(harness.location.href).searchParams.get('view'), 'configuration');
  assert.equal(harness.stored.get('paseo-manager-config-tab'), 'readiness');
  assert.equal(harness.replacements.length, 1);
  assert.ok(harness.clicks.some((selector) => selector.includes('data-config-tab="readiness"')));
});

test('setup and manager use the same canonical theme definition', () => {
  const html = enhanceSetupWithSharedUiTheme(setupWizardHtml({ requestedPage: 'paseo' }));
  assert.match(html, /data-paseo-ui-theme="setup"/);
  assert.match(html, /--paseo-primary:#2f6fed/);
  assert.match(html, /--paseo-panel:#171e28/);
  assert.match(html, /Setup walkthrough/);
});

test('required composition markers fail closed instead of silently dropping UI', () => {
  assert.equal(replaceRequiredHtml('<div>before MARK after</div>', 'MARK', 'replacement', 'test marker'), '<div>before replacement after</div>');
  assert.throws(
    () => replaceRequiredHtml('<div>no marker</div>', 'MARK', 'replacement', 'test marker'),
    /Required UI composition marker was not found: test marker/,
  );
});
