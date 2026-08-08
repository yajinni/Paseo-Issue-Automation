import assert from 'node:assert/strict';
import test from 'node:test';
import { managerHtml } from '../src/manager-review-ui.mjs';

test('lightweight PR-review and restart actions schedule a follow-up repository status sync', () => {
  const html = managerHtml();
  for (const action of ['review-worker/start', 'review-worker/restart', 'restart-issue']) {
    assert.match(html, new RegExp(action.replace('/', '\\/')));
  }
  assert.match(html, /lightweightActions\.has\(action\) && !body\?\.status/);
  assert.match(html, /queueMicrotask\(\(\) => window\.loadStatus\(\)\.catch/);
  assert.match(html, /return body/);
});

test('status-bearing actions do not schedule an extra refresh', () => {
  const html = managerHtml();
  assert.match(html, /!body\?\.status/);
  assert.doesNotMatch(html, /lightweightActions = new Set\([^)]*review-worker\/stop/);
});
