import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_CONFIGURATION_TABS_SCRIPT,
  MANAGER_CONFIGURATION_TABS_STYLE,
  enhanceManagerWithConfigurationTabs,
} from '../src/manager-configuration-tabs-ui.mjs';

test('configuration tabs use concise post-setup names', () => {
  for (const label of [
    'Connect Paseo',
    'Coding',
    'GitHub repository',
    'Issues setup',
    'Review setup',
    'Readiness',
  ]) assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(label));

  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['harness', 'Coding harness'\]/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /\['readiness', 'Final readiness'\]/);
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

test('review workflow changes immediately re-evaluate Review setup and readiness', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /getElementById\('review-workflow'\).*addEventListener\('change'/s);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /syncAutoMergeSetting\(\); showStep\(activeStep\); renderCurrentReadiness\(\)/);
});

test('automatic merge is presented as one full-width accessible setting with visible state', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-auto-merge-setting.*grid-column:1\/-1/s);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-auto-merge-switch/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /input:checked \+ \.manager-auto-merge-track/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function enhanceAutoMergeSetting\(\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /role', 'switch'/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-auto-merge-state/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /exact-head full-review approval, passing validation and checks/);
});

test('configuration tabs subscribe directly to manager status for current integration and readiness', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /window\.addManagerStatusListener\(\(data\) =>/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /renderRepositoryIntegration\(data\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /renderReadiness\(data\)/);
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
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Managed components/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Last checked/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-integration-summary/);
});

test('healthy standalone repositories show Connected and migration actions are conditional', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /title = 'Connected'/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /configured for the Paseo standalone manager/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration in progress/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration required/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migration ready to finalize/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Migrate to standalone manager/);
});

test('Readiness replaces legacy maintenance as the primary configuration surface', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /function buildReadiness\(configuration\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Can Paseo autonomously claim, code, review, and complete work/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Ready for autonomous work/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Checking readiness/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Advanced maintenance and diagnostics/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-readiness-card/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /manager-readiness-advanced/);
});

test('Readiness evaluates current prerequisites without treating intentional queue stops as failures', () => {
  for (const check of [
    'Repository setup',
    'Standalone repository integration',
    'GitHub base branch',
    'Paseo coding catalog',
    'Coder model',
    'Reviewer model',
    'Issue automation configuration',
    'Review workflow',
    'Coding worker availability',
    'PR review state',
  ]) assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, new RegExp(check));
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /review queue may be intentionally stopped without affecting readiness/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /queuePaused\s*!==\s*true/);
  assert.doesNotMatch(MANAGER_CONFIGURATION_TABS_SCRIPT, /claimsEnabled\s*===\s*true/);
});

test('Readiness shows failures first, passed checks collapsed, and direct recovery navigation', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /for \(const check of \[\.\.\.failed, \.\.\.pending\]\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-readiness-passed/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /check' \+ \(passed\.length === 1/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /showStep\(check\.step\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /manager-readiness-recheck/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /loadModelCatalog\(true\)/);
});

test('Web ChatGPT readiness is required only when the selected workflow requires it', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /chatGptProfile\?\.required === true/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /ChatGPT review profile/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /data\.chatGptProfile\.ready === true/);
});

test('legacy integration and maintenance sidebar destinations still redirect into Configuration', () => {
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"integration\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_STYLE, /data-manager-view-target=\"maintenance\"/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(integration, configuration, 'repository'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /moveViewCards\(maintenance, configuration, 'readiness'\)/);
  assert.match(MANAGER_CONFIGURATION_TABS_SCRIPT, /Open Configuration/);
});

test('configuration tab enhancer preserves existing manager markup and injects assets', () => {
  const source = '<html><head></head><body><main>manager</main></body></html>';
  const html = enhanceManagerWithConfigurationTabs(source);
  assert.match(html, /<main>manager<\/main>/);
  assert.match(html, /data-manager-configuration-tabs-style/);
  assert.match(html, /data-manager-configuration-tabs/);
});
