import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithUiFoundation,
  enhanceSetupWithSharedUiTheme,
  MANAGER_UI_FOUNDATION_CSS,
} from '../src/manager-ui-foundation.mjs';
import { replaceRequiredHtml } from '../src/ui-html.mjs';
import { PASEO_UI_THEME_CSS } from '../src/ui-theme.mjs';
import { setupWizardHtml } from '../src/setup-wizard/ui.mjs';

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
  assert.match(html, /<main id="manager">Keep me<\/main>/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /linear-gradient\(180deg,var\(--paseo-bg\),var\(--paseo-bg-bottom\)\)/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /\.card,\.manager-overview/);
  assert.match(MANAGER_UI_FOUNDATION_CSS, /button:not\(\.secondary\):not\(\.warning\):not\(\.danger\)/);
  assert.ok(html.indexOf('.existing{display:block}') < html.indexOf('data-manager-ui-foundation'));
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
