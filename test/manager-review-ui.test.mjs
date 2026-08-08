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

test('same-repository status refreshes preserve an unsaved configuration draft', () => {
  const html = managerHtml();
  assert.match(html, /let configDraftRepositoryId = null/);
  assert.match(html, /function captureConfigDraft\(\)/);
  assert.match(html, /function restoreConfigDraft\(draft\)/);
  assert.match(html, /configDraftRepositoryId === repositoryId \? captureConfigDraft\(\) : null/);
  assert.match(html, /if \(draft && currentRepositoryId === repositoryId\) restoreConfigDraft\(draft\)/);
  assert.match(html, /configForm\?\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test('configuration save discard and repository switch intentionally drop the old draft', () => {
  const html = managerHtml();
  assert.match(html, /action !== 'config' && configDraftRepositoryId === repositoryId/);
  assert.match(html, /if \(action === 'config'\) clearConfigDraft\(\)/);
  assert.match(html, /#manager-config-discard/);
  assert.match(html, /if \(configDraftRepositoryId && configDraftRepositoryId !== currentRepositoryId\) clearConfigDraft\(\)/);
});

test('restored review-workflow drafts reapply conditional configuration presentation', () => {
  const html = managerHtml();
  assert.match(html, /syncAutoMergeAvailability/);
  assert.match(html, /workflow\?\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});
