import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardHtml } from '../src/ui.mjs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('settings renders one compact Components panel without the JSON preview', () => {
  const html = dashboardHtml();

  assert.match(html, /<h2>Components<\/h2>/);
  assert.match(html, /id="components-action"[^>]*>Install components<\/button>/);
  assert.doesNotMatch(html, /Refresh preview/);
  assert.doesNotMatch(html, /Install shown components/);
  assert.doesNotMatch(html, /<pre id="install-preview"/);

  assert.match(html, /id="component-issue-template"/);
  assert.match(html, /id="component-paseo-service"/);
  assert.match(html, /id="component-github-labels"/);
  assert.match(html, /id="component-workspace"/);
  assert.equal((html.match(/>Reinstall<\/button>/g) || []).length, 4);
});

test('GitHub labels are summarized as one status card', () => {
  const html = dashboardHtml();
  const componentsPanel = html.match(/<article class="card setup-step" id="installation-card"[\s\S]*?<\/article>/)?.[0] || '';

  assert.match(componentsPanel, /<strong>GitHub lifecycle labels<\/strong>/);
  assert.equal((componentsPanel.match(/id="component-github-labels"/g) || []).length, 1);
  assert.doesNotMatch(componentsPanel, /Remove label/);
  assert.doesNotMatch(componentsPanel, /Install or repair missing labels/);
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
