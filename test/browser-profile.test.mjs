import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireBrowserProfileLease,
  browserPaths,
  loadBrowserConfig,
  releaseBrowserProfileLease,
  saveBrowserConfig,
  uninstallBrowserState,
} from '../src/browser-profile.mjs';

test('dedicated browser profile lives outside the repository and is owner-only', (t) => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-browser-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const paths = browserPaths({ dataRoot });
  assert.equal((statSync(paths.profile).mode & 0o777), 0o700);
  const config = saveBrowserConfig({ globalConversationUrl: 'https://chatgpt.com/c/abc' }, { dataRoot });
  assert.equal(config.globalConversationUrl, 'https://chatgpt.com/c/abc');
  const first = acquireBrowserProfileLease({ dataRoot, owner: 'one' });
  assert.equal(first.acquired, true);
  assert.equal(acquireBrowserProfileLease({ dataRoot, owner: 'two' }).acquired, false);
  releaseBrowserProfileLease(first.lease.id, { dataRoot });
});

test('Chromium uninstall state preserves the ChatGPT profile and credentials', (t) => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-browser-uninstall-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const paths = browserPaths({ dataRoot });
  saveBrowserConfig({
    globalConversationUrl: 'https://chatgpt.com/c/project',
    lastConversationUrl: 'https://chatgpt.com/c/project',
    lastAuthenticatedAt: '2026-08-05T00:00:00.000Z',
    browserInstalledAt: '2026-08-05T00:00:00.000Z',
  }, { dataRoot });

  const result = uninstallBrowserState({ dataRoot });
  const config = loadBrowserConfig({ dataRoot });
  assert.equal(result.chromiumStateCleared, true);
  assert.equal(result.profilePreserved, true);
  assert.equal(result.credentialsPreserved, true);
  assert.equal(result.conversationPreserved, true);
  assert.equal(existsSync(paths.profile), true);
  assert.equal(existsSync(paths.config), true);
  assert.equal(config.browserInstalledAt, null);
  assert.equal(config.lastAuthenticatedAt, '2026-08-05T00:00:00.000Z');
  assert.equal(config.globalConversationUrl, 'https://chatgpt.com/c/project');
});
