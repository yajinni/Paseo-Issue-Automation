import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MANAGER_WORK_QUEUE_SCRIPT,
  MANAGER_WORK_QUEUE_STYLE,
} from '../src/manager-work-queue-ui.mjs';
import {
  MANAGER_LIFECYCLE_CARDS_SCRIPT,
  MANAGER_LIFECYCLE_CARDS_STYLE,
} from '../src/manager-lifecycle-cards-ui.mjs';

const composition = readFileSync(new URL('../src/manager-work-queue-ui.mjs', import.meta.url), 'utf8');

test('expanded lifecycle uses Claimed as its first user-facing card and has no Available card', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /'Claimed'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /claimedCard\(details\), codingCard\(details\)/);
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /cardFrame\([^\n]*'Available'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /selected this issue for processing and placed it in the queue to be passed to a coding agent/i);
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /time before claim/i);
});

test('lifecycle cards show true claim facts and keep Coding separate', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Issue created/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Claimed by Paseo/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Claimed by/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /'Coding'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Coding started/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Coding completed/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Waiting for coding agent/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /The coding attempt ended without a successful handoff/);
});

test('review cards are data-driven Light, Heavy PR, and ChatGPT stages', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /review\.type === 'light'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /review\.type === 'heavy'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /review\.type === 'chatgpt'/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Web ChatGPT \(Browser\)/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Open conversation/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Review round/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Issues found/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Blocking issues/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /review\.reviewJobId[\s\S]*Queued/);
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /text: 'Optional'/);
});

test('Completed consolidates merge, closure, final status, and compact lifecycle trail', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Merge information/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Issue closure/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /Final status/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /lifecycle-mini-trail/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /\['Merged', completed\.mergedAt\]/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /\['Closed', completed\.issueClosedAt/);
  assert.match(MANAGER_LIFECYCLE_CARDS_STYLE, /\.lifecycle-card\.completed\{grid-column:1\/-1/);
});

test('normal Work Queue composition removes old focus/review enhancers and keeps right-side activity controls', () => {
  assert.doesNotMatch(composition, /manager-lifecycle-stage-focus-ui/);
  assert.doesNotMatch(composition, /manager-expanded-review-ui/);
  assert.match(composition, /manager-expanded-side-actions-ui/);
  assert.match(composition, /manager-lifecycle-cards-ui/);
  assert.ok(
    composition.indexOf('MANAGER_EXPANDED_SIDE_ACTIONS_SCRIPT') < composition.indexOf('MANAGER_LIFECYCLE_CARDS_SCRIPT'),
    'side actions should be arranged before lifecycle cards replace the left side',
  );
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Activity Timeline/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Details/);
  assert.match(MANAGER_WORK_QUEUE_SCRIPT, /Actions ▾/);
  assert.doesNotMatch(MANAGER_WORK_QUEUE_SCRIPT, /Review Evidence —/);
});

test('lifecycle details are loaded only for an expanded issue and the Activity Timeline is not replaced', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /\.lifecycle-expanded/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /issues\/['"]? \+ issueNumber \+ ['"]?\/lifecycle-details/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /const main = panel\.querySelector\('\.lifecycle-main'\)/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /main\.textContent = ''/);
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /activity-card[^\n]*remove/);
  assert.match(MANAGER_WORK_QUEUE_STYLE, /\.lifecycle-expanded\{display:grid/);
});

test('expanded lifecycle refetches after dashboard rerenders instead of reusing stale issue details', () => {
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /const cache = new Map/);
  assert.doesNotMatch(MANAGER_LIFECYCLE_CARDS_SCRIPT, /cache\.has|cache\.set/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /const loading = new Map/);
  assert.match(MANAGER_LIFECYCLE_CARDS_SCRIPT, /jsonRequest\(selectedPath\('issues\/['"]? \+ issueNumber/);
});

test('lifecycle card grid stays responsive while Completed remains full width when space allows', () => {
  assert.match(MANAGER_LIFECYCLE_CARDS_STYLE, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(MANAGER_LIFECYCLE_CARDS_STYLE, /@media\(max-width:1180px\)/);
  assert.match(MANAGER_LIFECYCLE_CARDS_STYLE, /@media\(max-width:620px\)/);
  assert.match(MANAGER_LIFECYCLE_CARDS_STYLE, /grid-template-columns:1fr/);
});
