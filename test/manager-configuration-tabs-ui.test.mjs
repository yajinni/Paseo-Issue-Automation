import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_CONFIGURATION_TABS_SCRIPT,
  MANAGER_CONFIGURATION_TABS_STYLE,
  enhanceManagerWithConfigurationTabs,
} from '../src/manager-configuration-tabs-ui.mjs';

test('configuration tabs mirror the simplified setup walkthrough', () => {
  for (const label of [
    'Connect Paseo',
    'Coding harness',
    'GitHub repository',
    'Issues setup',
    'Review setup',
    'Final readiness',
  ]) assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(label));

  for (const path of ['/setup/paseo', '/setup/harness', '/setup/repository', '/setup/issues', '/setup/review', '/setup/readiness']) {
    assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(path.replaceAll('/', '\\/')));
  }
});

test('integration and maintenance become configuration content instead of sidebar destinations', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"integration\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"maintenance\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(integration, configuration, 'repository'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(maintenance, configuration, 'readiness'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Open Configuration/);
});

test('configuration fields are grouped under their matching setup tabs without cloning inputs', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['Provider\/Coding Harness', 'harness'\]/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['Review model', 'harness'\]/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['Runtime', 'repository'\]/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['Issue processing', 'issues'\]/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['Review workflow', 'review'\]/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /cloneNode/);
});

test('configuration tab enhancer preserves the existing manager markup and injects assets', () => {
  const source = '<html><head></head><body><main>manager</main></body></html>';
  const html = enhanceManagerWithConfigurationTabs(source);
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-configuration-tabs-style/);
  assert.match(html, /data-manager-configuration-tabs/);
});
