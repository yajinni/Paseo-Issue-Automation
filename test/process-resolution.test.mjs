import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommand, windowsPaseoCandidates } from '../src/process.mjs';

test('Windows Paseo discovery checks the bundled desktop CLI outside PATH', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Julie\\AppData\\Local',
    APPDATA: 'C:\\Users\\Julie\\AppData\\Roaming',
    Path: '',
  };
  const bundled = windowsPaseoCandidates(env)[0];
  const result = resolveCommand('paseo', {
    platform: 'win32',
    env,
    existsSync: (candidate) => candidate === bundled,
  });
  assert.equal(result.available, true);
  assert.equal(result.path, bundled);
  assert.equal(result.source, 'paseo-desktop');
});

test('Windows Paseo discovery checks the global npm shim outside inherited PATH', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Julie\\AppData\\Local',
    APPDATA: 'C:\\Users\\Julie\\AppData\\Roaming',
    Path: '',
  };
  const npmShim = windowsPaseoCandidates(env).find((candidate) => candidate.toLowerCase().includes('npm'));
  const result = resolveCommand('paseo', {
    platform: 'win32',
    env,
    existsSync: (candidate) => candidate === npmShim,
  });
  assert.equal(result.available, true);
  assert.equal(result.path, npmShim);
  assert.equal(result.source, 'npm-global');
});

test('missing commands remain unavailable when no candidate exists', () => {
  const result = resolveCommand('paseo', {
    platform: 'win32',
    env: { Path: '' },
    existsSync: () => false,
  });
  assert.deepEqual(result, {
    available: false,
    command: 'paseo',
    path: null,
    source: 'missing',
  });
});
