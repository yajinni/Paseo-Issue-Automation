import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveCommand, windowsPaseoCandidates } from '../src/process.mjs';

test('Windows Paseo resolution includes the desktop-installed user-local CLI trampoline', () => {
  const env = {
    USERPROFILE: 'C:\\Users\\Ada',
    Path: '',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  };
  const expected = path.join(env.USERPROFILE, '.local', 'bin', 'paseo.cmd');
  assert.ok(windowsPaseoCandidates(env).includes(expected));

  const resolved = resolveCommand('paseo', {
    platform: 'win32',
    env,
    existsSync: (candidate) => candidate === expected,
  });
  assert.deepEqual(resolved, {
    available: true,
    command: 'paseo',
    path: expected,
    source: 'paseo-desktop',
  });
});

test('Windows Paseo resolution also honors HOME for user-local desktop installs', () => {
  const env = {
    HOME: 'D:\\Profiles\\Grace',
    Path: '',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  };
  const expected = path.join(env.HOME, '.local', 'bin', 'paseo.cmd');
  assert.ok(windowsPaseoCandidates(env).includes(expected));
});
