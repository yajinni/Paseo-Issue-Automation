import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardHtml } from '../src/ui.mjs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function componentsPanel() {
  return dashboardHtml().match(/<article class="card setup-step" id="installation-card"[\s\S]*?<\/article>/)?.[0] || '';
}

test('settings renders one compact Components panel without the JSON preview', () => {
  const panel = componentsPanel();

  assert.match(panel, /<h2>Components<\/h2>/);
  assert.match(panel, /id="components-action"[^>]*>Install components<\/button>/);
  assert.doesNotMatch(panel, /Refresh preview/);
  assert.doesNotMatch(panel, /Install shown components/);
  assert.doesNotMatch(panel, /<pre id="install-preview"/);

  assert.match(panel, /id="component-issue-template"/);
  assert.match(panel, /id="component-paseo-service"/);
  assert.match(panel, /id="component-github-labels"/);
  assert.match(panel, /id="component-workspace"/);
  assert.equal((panel.match(/>Reinstall<\/button>/g) || []).length, 4);
});

test('GitHub labels are summarized as one status card', () => {
  const panel = componentsPanel();

  assert.match(panel, /<strong>GitHub lifecycle labels<\/strong>/);
  assert.equal((panel.match(/id="component-github-labels"/g) || []).length, 1);
  assert.doesNotMatch(panel, /Remove label/);
  assert.doesNotMatch(panel, /Install or repair missing labels/);
});

test('component action switches to safe component-only uninstall when healthy', () => {
  const script = source('src/components-ui-script.mjs');

  assert.match(script, /state\.allHealthy \? 'Uninstall components' : 'Install components'/);
  assert.match(script, /issueTemplate: true/);
  assert.match(script, /paseoService: true/);
  assert.match(script, /labels: true/);
  assert.match(script, /workspace: true/);
  assert.match(script, /localState: false/);
  assert.match(script, /forceLabels: false/);
  assert.match(script, /\/api\/repair\/label/);
});
