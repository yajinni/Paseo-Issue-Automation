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

test('configuration tab content is explicitly hidden when it does not belong to the active tab', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /\[data-config-step\]\[hidden\].*display:none!important/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function setElementHidden\(element, hidden\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /style\.setProperty\('display', 'none', 'important'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /setElementHidden\(element, element\.dataset\.configStep !== step\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /configConditionalHidden/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /paseo:configuration-tab/);
});

test('review workflow changes immediately re-evaluate conditional Review setup content', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /getElementById\('review-workflow'\).*addEventListener\('change'/s);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /queueMicrotask\(\(\) => showStep\(activeStep\)\)/);
});

test('configuration groups map to the setup tab that owns them', () => {
  for (const mapping of [
    "['Coder model', 'harness']",
    "['Review model', 'harness']",
    "['Provider/Coding Harness', 'harness']",
    "['GitHub repository', 'repository']",
    "['Issue processing', 'issues']",
    "['Review workflow', 'review']",
    "['ChatGPT Profile', 'review']",
  ]) assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('integration and maintenance become configuration content instead of sidebar destinations', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"integration\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"maintenance\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(integration, configuration, 'repository'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(maintenance, configuration, 'readiness'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Open Configuration/);
});

test('configuration tab enhancer preserves the existing manager markup and injects assets', () => {
  const source = '<html><head></head><body><main>manager</main></body></html>';
  const html = enhanceManagerWithConfigurationTabs(source);
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-configuration-tabs-style/);
  assert.match(html, /data-manager-configuration-tabs/);
});
