import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  browserPaths,
  loadBrowserConfig,
  resetBrowserProfile,
  saveBrowserConfig,
} from '../src/browser-profile.mjs';

test('reset browser profile clears authentication metadata while preserving configuration', () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-browser-reset-'));
  const options = { dataRoot };
  try {
    const paths = browserPaths(options);
    writeFileSync(path.join(paths.profile, 'session-cookie'), 'secret', 'utf8');
    saveBrowserConfig({
      globalConversationUrl: 'https://chatgpt.com/c/global-review',
      lastConversationUrl: 'https://chatgpt.com/c/last-review',
      lastAuthenticatedAt: '2026-08-05T18:00:00.000Z',
      browserInstalledAt: '2026-08-05T17:00:00.000Z',
    }, options);

    const result = resetBrowserProfile(options);
    const config = loadBrowserConfig(options);

    assert.deepEqual(result, { reset: true, authenticationCleared: true });
    assert.equal(existsSync(path.join(paths.profile, 'session-cookie')), false);
    assert.equal(config.lastConversationUrl, null);
    assert.equal(config.lastAuthenticatedAt, null);
    assert.equal(config.globalConversationUrl, 'https://chatgpt.com/c/global-review');
    assert.equal(config.browserInstalledAt, '2026-08-05T17:00:00.000Z');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
