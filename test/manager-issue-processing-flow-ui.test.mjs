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

test('issue workload presents dependency waves before detailed rows', () => {
  for (const text of [
    'Automatic processing flow',
    'Each column is a dependency wave',
    'Unlocks:',
    'After:',
    'Up to ',
    'Issue details',
  ]) assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-issue-wave\+\.manager-issue-wave::before/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /details\.append\(detailsSummary, list\)/);
});

test('unified processing visibly reports mismatched internal state as attention', () => {
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Needs attention — worker stopped/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT, /Needs attention — worker running while paused/);
  assert.match(MANAGER_ISSUE_PROCESSING_FLOW_STYLE, /manager-issue-processing-state\.attention/);
});

test('enhancer appends issue-flow assets without replacing manager markup', () => {
  const html = enhanceManagerWithIssueProcessingFlow('<html><head></head><body><main id="manager"></main></body></html>');
  assert.match(html, /data-manager-issue-processing-flow-style/);
  assert.match(html, /data-manager-issue-processing-flow/);
  assert.match(html, /<main id="manager"><\/main>/);
});
