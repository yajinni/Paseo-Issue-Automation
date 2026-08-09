import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';

test('expanded review keeps the selected PR Health + Review Details + Review Evidence + Timeline structure', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review Details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review Evidence/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Conversation Summary/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Structured Review Result/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Activity Timeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /pr-health-card/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /review-evidence-card/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.expanded-review-details-card/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.review-evidence-card/);
});

test('Light and Heavy review panels show configured model/thinking plus truthful round and exact-head evidence', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /evidence\.type === 'web-chatgpt'/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.review\?\.model/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /item\.review\?\.thinking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review round/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Exact head/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review requested/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review submitted/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review completed/);
});

test('Web ChatGPT review uses browser/conversation identity and never invents model or transcript metrics', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Web ChatGPT \(Browser\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Open Web ChatGPT conversation/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /browser review job, conversation identity, exact PR head/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Transcript message counts, pages reviewed/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Messages exchanged/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Pages reviewed/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Artifacts analyzed/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Web ChatGPT.*Thinking:/s);
});

test('findings summary renders only recorded blocking and non-blocking counts', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Blocking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Non-blocking/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Total findings/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Structured finding counts are not recorded/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /will not infer severity counts from prose/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /High \(0\)/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Medium \(0\)/);
});

test('recorded findings preserve file location and required change/test evidence', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /finding\.file/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /finding\.line/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Required change:/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Required test:/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.review-finding-list/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.review-finding\.blocking/);
});

test('recorded Light-to-full handoff is shown as escalation only when evidence exists', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /if \(evidence\.handoff\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Escalated from Light Review/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /unresolvedCount/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.expanded-review-handoff/);
});

test('review evidence exposes job/request/prompt/result source without replacing Details troubleshooting', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review job/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Review request/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Prompt version/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Result source/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Attempts/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Deep troubleshooting/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Current PR health diagnosis/);
});

test('expanded review respects lifecycle stage focus and remains visible for Review Queued/Reviewing', () => {
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /reviewVisibleForFocus/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /\['review-queued', 'reviewing'\]\.includes\(focused\)/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /data-lifecycle-focus/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /lifecycle-focus-clear/);
});

test('expanded review uses the existing dashboard subdued colors and responsive stacking', () => {
  assert.match(MANAGER_WORK_QUEUE_STYLE, /background:#101720/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /border:1px solid #2d394b/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /color:#718298/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /@media\(max-width:760px\)/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /expanded-review-body\{grid-template-columns:1fr\}/);
});
