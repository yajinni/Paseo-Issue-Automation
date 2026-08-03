import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireBrowserProfileLease, browserPaths, releaseBrowserProfileLease, saveBrowserConfig } from '../src/browser-profile.mjs';

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
