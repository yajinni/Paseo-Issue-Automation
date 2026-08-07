import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithRepositoryPaseo,
  REPOSITORY_PASEO_SCRIPT,
} from '../../src/setup-wizard/repository-paseo-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('repository Paseo status does not use setup fetch wrapper that rerenders the shell', () => {
  assert.match(REPOSITORY_PASEO_SCRIPT, /new XMLHttpRequest\(\)/);
  assert.match(REPOSITORY_PASEO_SCRIPT, /\/api\/setup\/github\/paseo-status/);
  assert.doesNotMatch(REPOSITORY_PASEO_SCRIPT, /fetch\(['"]\/api\/setup\/github\/paseo-status/);
});

test('repository Paseo card ignores mutations caused only by its own rendering', () => {
  assert.match(REPOSITORY_PASEO_SCRIPT, /mutationComesOnlyFromPaseoCard/);
  assert.match(REPOSITORY_PASEO_SCRIPT, /node\.id === 'github-paseo-project-card'/);
  assert.match(REPOSITORY_PASEO_SCRIPT, /mutations\.every\(mutationComesOnlyFromPaseoCard\)/);
});

test('repository Paseo enhancer still adds one status card script to setup', () => {
  const html = enhanceSetupWizardWithRepositoryPaseo(setupWizardHtml({ requestedPage: 'repository' }));
  assert.match(html, /data-setup-repository-paseo/);
  assert.match(html, /Issue Coding Automation/);
});
