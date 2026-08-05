import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePorcelainStatus, setupChangeStatus } from '../src/setup-pr.mjs';

function ok(stdout = '') {
  return { ok: true, exitCode: 0, stdout, stderr: '' };
}

test('repairs a first-line worktree-only status after command output trimming', () => {
  assert.deepEqual(parsePorcelainStatus('M package-lock.json\n M package.json\n?? paseo.json'), [
    { status: ' M', path: 'package-lock.json' },
    { status: ' M', path: 'package.json' },
    { status: '??', path: 'paseo.json' },
  ]);
});

test('keeps a valid first-line index-only status unchanged', () => {
  assert.deepEqual(parsePorcelainStatus('M  package-lock.json'), [
    { status: 'M ', path: 'package-lock.json' },
  ]);
});

test('classifies a trimmed package-lock status as an expected setup file', () => {
  const runner = (_command, args) => {
    if (args[0] === 'status') return ok('M package-lock.json');
    if (args[0] === 'branch') return ok('main');
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };

  const status = setupChangeStatus('/repo', { runner });
  assert.deepEqual(status.changedFiles, ['package-lock.json']);
  assert.deepEqual(status.expectedFiles, ['package-lock.json']);
  assert.deepEqual(status.unexpectedFiles, []);
});
