import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { browserPaths, resetBrowserProfile, uninstallBrowserState } from '../src/browser-profile.mjs';

function expiredLock() {
  return JSON.stringify({
    id: 'expired',
    pid: 999999,
    acquiredAt: '2000-01-01T00:00:00.000Z',
    heartbeatAt: '2000-01-01T00:00:00.000Z',
    expiresAt: '2000-01-01T00:01:00.000Z',
  });
}

test('profile reset clears an expired browser lock', (t) => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-browser-reset-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const paths = browserPaths({ dataRoot });
  writeFileSync(paths.lock, expiredLock());
  assert.deepEqual(resetBrowserProfile({ dataRoot }), { reset: true });
  assert.equal(existsSync(paths.lock), false);
  assert.equal(existsSync(paths.profile), true);
});

test('Chromium uninstall clears expired locks while preserving browser profile state', (t) => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-browser-uninstall-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const paths = browserPaths({ dataRoot });
  writeFileSync(paths.lock, expiredLock());
  writeFileSync(paths.reviewSchedulerLock, expiredLock());
  const result = uninstallBrowserState({ dataRoot });
  assert.equal(result.chromiumStateCleared, true);
  assert.equal(result.profilePreserved, true);
  assert.equal(result.configPreserved, true);
  assert.equal(existsSync(paths.lock), false);
  assert.equal(existsSync(paths.reviewSchedulerLock), false);
  assert.equal(existsSync(paths.root), true);
  assert.equal(existsSync(paths.profile), true);
  assert.equal(existsSync(paths.config), true);
});
