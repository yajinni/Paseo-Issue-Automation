import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireLease,
  readLease,
  releaseLease,
  renewLease,
  transferLease,
} from '../src/durable-lease.mjs';

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

test('a scheduler lease can transfer ownership to its detached worker', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-lease-transfer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'worker.lock');
  const acquired = acquireLease(file, {
    owner: 'scheduler',
    pid: process.pid,
    ttlMs: 10_000,
    requireLiveProcess: false,
  });
  const transferred = transferLease(file, acquired.lease.id, {
    owner: 'worker',
    pid: process.pid,
    ttlMs: 20_000,
    metadata: { jobId: 'review-1' },
  });
  assert.equal(transferred.owner, 'worker');
  assert.equal(transferred.pid, process.pid);
  assert.equal(transferred.metadata.jobId, 'review-1');
  assert.equal(releaseLease(file, 'wrong-owner').released, false);
  assert.equal(readLease(file).id, acquired.lease.id);
  assert.equal(releaseLease(file, acquired.lease.id).released, true);
});
