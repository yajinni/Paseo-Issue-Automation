import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithConfigIntegrationMaintenance,
  MANAGER_CONFIG_INTEGRATION_SCRIPT,
  MANAGER_CONFIG_INTEGRATION_STYLE,
} from '../src/manager-config-integration-maintenance-ui.mjs';

test('Configuration is grouped into setup-style operational sections', () => {
  for (const group of ['Provider/Coding Harness', 'Review model', 'Issue processing', 'Review workflow', 'Runtime']) {
    assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, new RegExp(group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const id of ['coding-harness', 'coder-model', 'reviewer-model', 'issue-selection-mode', 'review-workflow', 'base-branch']) {
    assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, new RegExp(id));
  }
});

test('manager configuration uses the same review workflow wording as setup', () => {
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Light model review → Manual review/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Light model review → Web ChatGPT full review/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /I selected a heavy review model to do the job\./);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Light model review rounds/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /fullField\.hidden = workflow === 'quick-manual'/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Automatic merge is unavailable for Light model review → Manual review/);
});

test('Configuration shows dirty state inline validation Save and Discard without changing submit semantics', () => {
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /snapshotConfigForm/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /validateConfigForm/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Unsaved configuration changes/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Discard changes/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /button\[type="submit"\]/);
  assert.match(MANAGER_CONFIG_INTEGRATION_STYLE, /position:sticky/);
});

test('Integration adds a concise ownership summary and collapses repository setup diagnostics', () => {
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Integration summary/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Managed repository integration/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Repository and setup technical details/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Integration actions only change manager-owned components/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /reviewed pull requests/);
});

test('Maintenance starts with health and recovery summary based on existing operational blockers', () => {
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /Health & recovery/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /operational\.issueProcessing/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /operational\.prReviews/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /item\.severity === 'warning'/);
  assert.match(MANAGER_CONFIG_INTEGRATION_SCRIPT, /item\.severity === 'error'/);
});

test('Configuration and context grids collapse to a single column on narrow screens', () => {
  assert.match(MANAGER_CONFIG_INTEGRATION_STYLE, /@media\(max-width:760px\)/);
  assert.match(MANAGER_CONFIG_INTEGRATION_STYLE, /manager-config-groups.*grid-template-columns:1fr/);
});

test('enhancer appends its assets and preserves the existing manager document', () => {
  const html = enhanceManagerWithConfigIntegrationMaintenance('<html><head></head><body><main class="shell"></main></body></html>');
  assert.match(html, /data-manager-config-integration-style/);
  assert.match(html, /data-manager-config-integration/);
  assert.match(html, /<main class="shell"><\/main>/);
});
