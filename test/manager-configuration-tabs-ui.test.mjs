import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_CONFIGURATION_TABS_SCRIPT,
  MANAGER_CONFIGURATION_TABS_STYLE,
  enhanceManagerWithConfigurationTabs,
} from '../src/manager-configuration-tabs-ui.mjs';

test('configuration tabs mirror the simplified setup walkthrough without recreating setup link cards', () => {
  for (const label of [
    'Connect Paseo',
    'Coding',
    'GitHub repository',
    'Issues setup',
    'Review setup',
    'Final readiness',
  ]) assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(label));

  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['harness', 'Coding harness'\]/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /setupLinkCard/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /Edit this setup step/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_STYLE, /manager-config-step-link/);
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
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /queueMicrotask\(\(\) => \{ syncAutoMergeSetting\(\); showStep\(activeStep\); \}\)/);
});

test('automatic merge is presented as one full-width accessible setting with visible state', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-auto-merge-setting.*grid-column:1\/-1/s);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-auto-merge-switch/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /input:checked \+ \.manager-auto-merge-track/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function enhanceAutoMergeSetting\(\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /role', 'switch'/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-auto-merge-state/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Enabled/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Disabled/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Unavailable/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /exact-head full-review approval, passing validation and checks/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /syncAutoMergeSetting\(\)/);
});

test('configuration tabs subscribe directly to the manager status hub', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /window\.addManagerStatusListener\(\(data\) =>/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /renderRepositoryIntegration\(data\)/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /window\.renderStatus\s*=/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /previousRenderStatus/);
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

test('Coding uses Paseo-reported model and thinking dropdowns', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /ensureSelect\('coder-model', 'Coder model'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /ensureSelect\('reviewer-model', 'Reviewer model'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /ensureSelect\('coder-thinking', 'Coder thinking level'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /ensureSelect\('reviewer-thinking', 'Reviewer thinking level'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /configuration\/harnesses/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /thinkingOptionIds/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /defaultThinkingOptionId/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /currently configured; not reported by Paseo/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /step === 'harness'\) loadModelCatalog/);
});

test('model choices follow the selected coding harness and refresh with harness discovery', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function providerForHarness\(\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /getElementById\('coding-harness'\).*addEventListener\('change'/s);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-refresh-harnesses/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-model-catalog-note/);
});

test('repository integration is a compact current-state card with advanced history', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function simplifyRepositoryIntegration\(\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Repository Integration/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Advanced \/ Migration history/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-integration-state/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Managed components/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Last checked/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-integration-summary/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-integration-advanced/);
});

test('healthy standalone repositories show Connected without surfacing meaningless migration state', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /title = 'Connected'/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /configured for the Paseo standalone manager/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /external && setup\.complete === true && pendingFiles\.length === 0/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-integration-summary[^]*Migration state: Not started/);
});

test('migration controls are promoted only when migration is actually relevant', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration in progress/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration required/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration ready to finalize/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /capabilities\.migrationReconciliation/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /capabilities\.migrationAdoption/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /capabilities\.embeddedMigration/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migrate to standalone manager/);
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
