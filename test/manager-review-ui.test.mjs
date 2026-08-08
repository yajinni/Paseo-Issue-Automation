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

test('same-repository status refreshes preserve the latest unsaved configuration draft', () => {
  const html = managerHtml();
  assert.match(html, /let configDraftRepositoryId = null/);
  assert.match(html, /let configDraftValues = null/);
  assert.match(html, /let configDraftVersion = 0/);
  assert.match(html, /function snapshotConfigFields\(\)/);
  assert.match(html, /configDraftValues = snapshotConfigFields\(\)/);
  assert.match(html, /configDraftVersion \+= 1/);
  assert.match(html, /function captureConfigDraft\(\)/);
  assert.match(html, /return configDraftValues\.map\(\(saved\) => \(\{ \.\.\.saved \}\)\)/);
  assert.match(html, /currentRepositoryId === repositoryId && configDraftRepositoryId === repositoryId/);
  assert.match(html, /restoreConfigDraft\(captureConfigDraft\(\)\)/);
  assert.match(html, /configForm\?\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test('drafts created after a refresh or unrelated action starts are still restored', () => {
  const html = managerHtml();
  assert.doesNotMatch(html, /const preserveDraft = configDraftRepositoryId === repositoryId/);
  assert.doesNotMatch(html, /const preserveDraft = action !== 'config'/);
  assert.match(html, /const result = await previousLoadStatus\(\.\.\.args\);\s*const currentRepositoryId = repositorySelect\?\.value \|\| null;\s*if \(currentRepositoryId === repositoryId && configDraftRepositoryId === repositoryId\)/);
  assert.match(html, /else if \(repositorySelect\?\.value === repositoryId && configDraftRepositoryId === repositoryId\) \{\s*restoreConfigDraft\(captureConfigDraft\(\)\)/);
});

test('synthetic restoration events do not masquerade as newer user edits', () => {
  const html = managerHtml();
  assert.match(html, /let restoringConfigDraft = false/);
  assert.match(html, /restoringConfigDraft = true/);
  assert.match(html, /if \(restoringConfigDraft\) return/);
  assert.match(html, /finally \{\s*restoringConfigDraft = false/);
});

test('configuration save clears only the submitted draft and preserves edits made while saving', () => {
  const html = managerHtml();
  assert.match(html, /const configDraftVersionAtStart = configDraftVersion/);
  assert.match(html, /configDraftVersion > configDraftVersionAtStart/);
  assert.match(html, /if \(hasNewerDraft\) restoreConfigDraft\(captureConfigDraft\(\)\)/);
  assert.match(html, /else if \(configDraftRepositoryId === repositoryId\) clearConfigDraft\(\)/);
});

test('configuration saves are single-flight so older server responses cannot win out of order', () => {
  const html = managerHtml();
  assert.match(html, /let configSaveInFlight = false/);
  assert.match(html, /const configSave = action === 'config'/);
  assert.match(html, /if \(configSave && configSaveInFlight\) throw new Error\('Configuration save is already in progress\.'\)/);
  assert.match(html, /if \(configSave\) configSaveInFlight = true/);
  assert.match(html, /finally \{\s*if \(configSave\) configSaveInFlight = false/);
});

test('discard and repository switch intentionally drop only the old draft', () => {
  const html = managerHtml();
  assert.match(html, /#manager-config-discard/);
  assert.match(html, /configDraftValues = null/);
  assert.match(html, /configDraftVersion = 0/);
  assert.match(html, /if \(configDraftRepositoryId && configDraftRepositoryId !== currentRepositoryId\) \{\s*clearConfigDraft\(\)/);
});

test('restored review-workflow drafts reapply conditional configuration presentation', () => {
  const html = managerHtml();
  assert.match(html, /syncAutoMergeAvailability/);
  assert.match(html, /workflow\?\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});
