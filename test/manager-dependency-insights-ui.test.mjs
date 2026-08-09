import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithDependencyInsights,
  MANAGER_DEPENDENCY_INSIGHTS_SCRIPT,
  MANAGER_DEPENDENCY_INSIGHTS_STYLE,
} from '../src/manager-dependency-insights-ui.mjs';

test('parallel work summary distinguishes structural readiness from runnable work and capacity', () => {
  for (const text of [
    'Structurally ready',
    'Runnable now',
    'Active',
    'Open slots',
    'Can start now',
    'min(runnable now, open slots)',
  ]) assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /Math\.min\(runnable, availableSlots\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /automation\?\.activeRunCount/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /statusId === 'next' \|\| item\.statusId === 'eligible'/);
});

test('structural readiness is unknown when native relationship data is incomplete', () => {
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /plan\?\.graph\?\.available === false/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /'Unknown'/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /Native relationship data is incomplete/);
});

test('selected issue insight traces authoritative upstream and downstream graph relationships', () => {
  for (const text of [
    'Selected issue',
    'Dependency depth',
    'Direct blockers',
    'Direct dependents',
    'Would become ready',
    'Total upstream',
    'Total downstream',
  ]) assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /walk\(selectedIssueNumber, graph\.dependencies \|\| \{\}\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /walk\(selectedIssueNumber, graph\.unlocks \|\| \{\}\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /graph\.levelByIssue/);
});

test('would-be-ready count requires the selected issue to be the only known open blocker', () => {
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /numberList\(graph\.dependencies\?\.\[dependent\]\)\.length === 1/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /numberList\(graph\.externalDependencies\?\.\[dependent\]\)\.length === 0/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /only remaining known open blocker/);
});

test('map selection supports click, keyboard focus, escape clearing, and relation highlighting', () => {
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /document\.addEventListener\('click'/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /document\.addEventListener\('focusin'/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /event\.key === 'Escape'/);
  for (const className of ['is-selected', 'is-upstream', 'is-downstream', 'is-dimmed']) {
    assert.match(MANAGER_DEPENDENCY_INSIGHTS_STYLE, new RegExp(className));
  }
});

test('insights observe the existing Issues plan and status streams without adding an API', () => {
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /window\.addManagerStatusListener\(statusListener\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /includes\('\/issues-plan'\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /previousJsonRequest\(url, options\)/);
  assert.doesNotMatch(MANAGER_DEPENDENCY_INSIGHTS_SCRIPT, /fetch\(/);
});

test('enhancer appends scoped assets without replacing the manager shell', () => {
  const html = enhanceManagerWithDependencyInsights('<html><head></head><body><main id="manager"></main></body></html>');
  assert.match(html, /data-manager-dependency-insights-style/);
  assert.match(html, /data-manager-dependency-insights/);
  assert.match(html, /<main id="manager"><\/main>/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_STYLE, /@media\(max-width:700px\)/);
  assert.match(MANAGER_DEPENDENCY_INSIGHTS_STYLE, /prefers-reduced-motion/);
});
