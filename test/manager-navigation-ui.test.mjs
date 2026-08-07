import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithNavigation,
  MANAGER_NAVIGATION_SCRIPT,
  MANAGER_NAVIGATION_STYLE,
  MANAGER_VIEW_IDS,
} from '../src/manager-navigation-ui.mjs';

test('manager navigation defines the approved left-sidebar views', () => {
  assert.deepEqual(MANAGER_VIEW_IDS, [
    'overview',
    'work-queue',
    'automation',
    'reviews',
    'configuration',
    'integration',
    'maintenance',
    'manager-settings',
  ]);
  for (const label of ['Overview', 'Work Queue', 'Automation', 'Reviews', 'Configuration', 'Integration', 'Maintenance', 'Manager Settings']) {
    assert.match(MANAGER_NAVIGATION_SCRIPT, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('manager navigation relocates every current manager area without changing action markup', () => {
  for (const heading of [
    'Repository',
    'Setup',
    'Manual issue action',
    'Latest action result',
    'Automation',
    'Automation controls',
    'Configuration',
    'Repository integration',
    'Manager-wide coding capacity',
  ]) {
    assert.match(MANAGER_NAVIGATION_SCRIPT, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(MANAGER_NAVIGATION_SCRIPT, /repository-health-panel/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /repository-maintenance-panel/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /manager-manual-registration/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /for \(const panel of shell\.querySelectorAll\('section\.card'\)\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /if \(!moved\.has\(panel\)\) appendPanel\(views\.maintenance/);
});

test('repository context and add-repository setup entry move into the sidebar', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /repository-select/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /data-manager-setup-link/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /manager-repository-context/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /sidebar\.append\(repositoryContext, buildNav\(\)\)/);
});

test('view navigation is deep-linkable and honors browser history', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /searchParams\.get\('view'\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /searchParams\.set\('view', id\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /searchParams\.delete\('view'\)/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /history\[historyMode === 'replace' \? 'replaceState' : 'pushState'\]/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /addEventListener\('popstate'/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /aria-current/);
});

test('sidebar has a responsive mobile drawer with keyboard escape handling', () => {
  assert.match(MANAGER_NAVIGATION_STYLE, /@media\(max-width:900px\)/);
  assert.match(MANAGER_NAVIGATION_STYLE, /translateX\(-105%\)/);
  assert.match(MANAGER_NAVIGATION_STYLE, /manager-sidebar-open/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /aria-controls/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /aria-expanded/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /event\.key === 'Escape'/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /manager-sidebar-scrim/);
});

test('review tab uses current manager v3 review state rather than legacy embedded labels', () => {
  assert.match(MANAGER_NAVIGATION_SCRIPT, /quick-manual/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /quick-web-chatgpt/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /full-immediate/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /reviewWorker\?\.running/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /quickMaxRounds/);
  assert.match(MANAGER_NAVIGATION_SCRIPT, /fullMaxRounds/);
  assert.doesNotMatch(MANAGER_NAVIGATION_SCRIPT, /agent-ready|agent-running|automation-blocked|human-review/);
});

test('navigation enhancer appends style in head and script at end of body', () => {
  const html = enhanceManagerWithNavigation('<html><head></head><body><main class="shell"></main></body></html>');
  assert.match(html, /data-manager-navigation-style/);
  assert.match(html, /data-manager-navigation/);
  assert.ok(html.indexOf('data-manager-navigation-style') < html.indexOf('</head>'));
  assert.ok(html.indexOf('data-manager-navigation') < html.indexOf('</body>'));
});
