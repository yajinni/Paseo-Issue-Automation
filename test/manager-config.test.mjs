import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadManagerConfig,
  managerConfigFile,
  saveManagerConfig,
  validateManagerConfig,
} from '../src/manager-config.mjs';

test('manager configuration defaults to two global coding slots', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-config-'));
  assert.deepEqual(loadManagerConfig({ rootDir }), { version: 1, globalMaxActive: 2 });
});

test('manager configuration saves atomically in the manager home', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paseo-manager-config-'));
  const saved = saveManagerConfig({ globalMaxActive: 7 }, { rootDir });
  assert.deepEqual(saved, { version: 1, globalMaxActive: 7 });
  assert.deepEqual(loadManagerConfig({ rootDir }), saved);
  assert.equal(JSON.parse(readFileSync(managerConfigFile({ rootDir }), 'utf8')).globalMaxActive, 7);
});

test('manager configuration rejects unsafe limits', () => {
  for (const value of [0, 51, 1.5, 'not-a-number']) {
    assert.throws(() => validateManagerConfig({ globalMaxActive: value }), /1 through 50/);
  }
});
