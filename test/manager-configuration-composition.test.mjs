import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_CONFIGURATION_TABS_SCRIPT,
  MANAGER_CONFIGURATION_TABS_STYLE,
} from '../src/manager-configuration-tabs-ui.mjs';

test('configuration tabs own setup-step navigation without transient setup-link cards', () => {
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /setupLinkCard|Edit this setup step/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_STYLE, /manager-config-step-link/);
});
