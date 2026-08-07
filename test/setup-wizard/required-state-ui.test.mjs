import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithRequiredState,
  REQUIRED_STATE_SCRIPT,
} from '../../src/setup-wizard/required-state-ui.mjs';

test('required-state enhancer gives incomplete setup cards a shared red treatment', () => {
  const html = enhanceSetupWizardWithRequiredState('<html><head></head><body><main id="page-content"></main></body></html>');
  assert.match(html, /data-setup-required-state-style/);
  assert.match(html, /data-setup-required-state/);
  assert.match(html, /setup-card\.required-missing/);
  assert.match(html, /setup-card\.required-check-failed/);
  assert.match(html, /#b74b4b/);
});

test('failed checklist rows automatically mark and unmark their containing setup card', () => {
  assert.match(REQUIRED_STATE_SCRIPT, /querySelectorAll\('\.setup-card'\)/);
  assert.match(REQUIRED_STATE_SCRIPT, /querySelector\('\.check-row\.bad'\)/);
  assert.match(REQUIRED_STATE_SCRIPT, /classList\.toggle\('required-check-failed'/);
  assert.match(REQUIRED_STATE_SCRIPT, /MutationObserver\(applyRequiredState\)/);
  assert.doesNotMatch(REQUIRED_STATE_SCRIPT, /attributes: true/);
});
