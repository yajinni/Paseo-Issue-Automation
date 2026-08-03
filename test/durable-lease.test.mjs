import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLease, readLease, releaseLease, renewLease } from '../src/durable-lease.mjs';

test('durable lease prevents simultaneous workers and can be renewed', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-lease-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'worker.lock');
  const first = acquireLease(file, { owner: 'first', ttlMs: 10_000 });
  assert.equal(first.acquired, true);
  assert.equal(acquireLease(file, { owner: 'second', ttlMs: 10_000 }).acquired, false);
  const renewed = renewLease(file, first.lease.id, { ttlMs: 20_000 });
  assert.equal(readLease(file).id, renewed.id);
  assert.equal(releaseLease(file, first.lease.id).released, true);
  assert.equal(acquireLease(file, { owner: 'second' }).acquired, true);
});
