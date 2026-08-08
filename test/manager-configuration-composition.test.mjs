import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_CONFIGURATION_TABS_SCRIPT,
  MANAGER_CONFIGURATION_TABS_STYLE,
} from '../src/manager-configuration-tabs-ui.mjs';
import { MANAGER_CONFIG_INTEGRATION_SCRIPT } from '../src/manager-config-integration-maintenance-ui.mjs';

test('configuration composition has a single owner for setup-tab navigation', () => {
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /setupLinkCard|Edit this setup step/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_STYLE, /manager-config-step-link/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /removeSetupLinkCards/);
});
