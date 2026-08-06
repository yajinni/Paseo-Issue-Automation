import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const documentation = readFileSync(
  new URL('../docs/EXISTING_MIGRATION_FINALIZATION.md', import.meta.url),
  'utf8',
);

test('existing migration guide documents the exact safe recovery path', () => {
  for (const phrase of [
    'Finalize existing migration',
    'package.json',
    'lockfile',
    'issue-coding-automation',
    'configured base branch',
    'working tree is clean',
    'no automation issue is active',
    'existing-repository-state',
    'keeps new issue claims paused',
  ]) assert.match(documentation, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('existing migration guide records Julie PR 380 and superseded setup PR 379', () => {
  assert.match(documentation, /Julie's Dashboard/);
  assert.match(documentation, /repository PR #380/);
  assert.match(documentation, /Setup PR #379 was closed as superseded/);
  assert.match(documentation, /rewrite\/openspec-baseline/);
});

test('existing migration guide does not direct operators to delete ownership state', () => {
  assert.match(documentation, /Do not delete machine-local state/);
  assert.match(documentation, /does not edit tracked repository files or create a pull request/);
});
