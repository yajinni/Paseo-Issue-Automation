import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithIssueProcessingFlow,
  MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT,
  MANAGER_ISSUE_PROCESSING_FLOW_STYLE,
} from '../src/manager-issue-processing-flow-ui.mjs';

test('Issues view collapses workflow and worker into one Issue processing card', () => {
  for (const text of [
    "title.textContent = 'Issue processing'",
    'Start issue processing',
    'Pause issue processing',
    'issue-processing/start',
    'issue-processing/pause',
    'Maximum simultaneous issues',
  ]) assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /layout\.replaceChildren\(card, workload\)/);
});

test('issue-processing actions leave busy and final disabled state to shared manager feedback', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /await window\.postRepositoryAction\(action\)/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /const original = button\.disabled/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /button\.disabled = true/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /button\.disabled = original/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /start\.disabled = state\.className === 'running'/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /pause\.disabled = state\.className === 'paused'/);
});

test('issue processing subscribes directly to the manager status hub', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /window\.addManagerStatusListener\(renderProcessing\)/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /window\.renderStatus\s*=/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /previousRenderStatus/);
});

test('Issue workload renders the large all-open dependency map from the server graph', () => {
  for (const text of [
    'Dependency map',
    'Every open issue is placed by real native GitHub dependency depth',
    'Ready now',
    'Waiting on 1 level',
    'Waiting on 2 levels',
    'Waiting on 3+ levels',
    'Unresolved / cycle',
    'Blocked by:',
    'Unlocks:',
    'Up to ',
    'Issue details',
  ]) assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /const graph = plan\.graph/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /for \(const entry of graph\.levels \|\| \[\]\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /graph\.dependencies\?\.\[number\]/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /graph\.unlocks\?\.\[number\]/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /function dependencyGraph\(/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Automatic processing flow/);
});

test('dependency map draws real blocker edges between rendered issue cards', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /function drawMapEdges\(plan\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Object\.entries\(graph\.dependencies \|\| \{\}\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /manager-dependency-map-edge/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /marker-end/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-dependency-map-edges/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-dependency-map-levels/);
});

test('Levels panel groups counts while exact graph levels remain separate columns', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /counts\.readyNow/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /counts\.waitingOnOneLevel/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /counts\.waitingOnTwoLevels/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /counts\.waitingOnThreePlusLevels/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /counts\.unresolved/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Exact levels remain visible as separate columns in the map/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /grid-template-columns:minmax\(0,1fr\) 230px/);
});

test('dependency map fails visibly when native relationship data is unavailable', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /graph\.available === false/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Native GitHub dependency data is unavailable/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Paseo will not invent dependency levels/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /graph\.unavailableIssueNumbers/);
});

test('dependency map preserves scroll position across issue-plan refresh and redraws edges', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /previousScroll\?\.scrollLeft/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /previousScroll\?\.scrollTop/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /scroll\.scrollLeft = scrollState\.left/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /scroll\.scrollTop = scrollState\.top/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /ResizeObserver/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /requestAnimationFrame/);
});

test('Issue map changes remain scoped inside the existing Issues workload card', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /document\.querySelector\('\[data-manager-view="automation"\]'\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /findCard\(view, 'Issue workload'\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /list\.before\(shell\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /details\.append\(detailsSummary, list\)/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /data-manager-view-target/);
  assert.doesNotMatch(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /repository-select.*replace/);
});

test('unified processing visibly reports mismatched internal state as attention', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Needs attention — worker stopped/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Needs attention — worker running while paused/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-issue-processing-state\.attention/);
});

test('large dependency map is responsive without changing the surrounding manager shell', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /@media\(max-width:1050px\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /@media\(max-width:700px\)/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-dependency-map-layout\{grid-template-columns:1fr\}/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-dependency-map-scroll\{max-height:620px\}/);
});

test('enhancer appends issue-flow assets without replacing manager markup', () => {
  const html = enhanceManagerWithIssueProcessingFlow('<html><head></head><body><main id="manager"></main></body></html>');
  assert.match(html, /data-manager-issue-processing-flow-style/);
  assert.match(html, /data-manager-issue-processing-flow/);
  assert.match(html, /<main id="manager"><\/main>/);
});
