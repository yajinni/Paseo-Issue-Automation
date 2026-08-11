import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWrite } from '../src/state.mjs';

test('atomicWrite retries transient Windows rename failures before preserving durable state', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-atomic-write-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.json');
  let attempts = 0;

  atomicWrite(file, 'next\n', {
    rename(source, target) {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('simulated transient Windows file lock');
        error.code = 'EPERM';
        throw error;
      }
      renameSync(source, target);
    },
    wait() {},
  });

  assert.equal(attempts, 3);
  assert.equal(readFileSync(file, 'utf8'), 'next\n');
});
