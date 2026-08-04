import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { dashboardHtml } from '../src/ui.mjs';

test('dashboard polling is guarded, visibility-aware, and avoids full settings rerenders', () => {
  const html = dashboardHtml();
  assert.match(html, /MIN_BACKGROUND_POLL_MS = 60_000/);
  assert.match(html, /if \(pollInFlight\)/);
  assert.match(html, /if \(document\.hidden\)/);
  assert.match(html, /renderOperationalState\(data\)/);
  assert.match(html, /result && result\.snapshot/);
  assert.match(html, /Dashboard status polling exceeded 20 seconds/);
});

test('requirements and model catalog use separate refresh modes and budgets', () => {
  const html = dashboardHtml();
  assert.match(html, /'requirements-check-again', 'Check again', 'requirements'/);
  assert.match(html, /'refresh-setup-options', 'Refresh branches and models', 'catalog'/);
  assert.match(html, /catalogRefresh \? 25_000 : 12_000/);
  assert.match(html, /refreshValue = catalogRefresh \? 'setup' : 'requirements'/);
});

test('all generated inline dashboard scripts compile', () => {
  const html = dashboardHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 4);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `dashboard-inline-${index}.js` }));
  });
});
