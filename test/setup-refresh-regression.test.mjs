import assert from 'node:assert/strict';
import test from 'node:test';
import { SETUP_REFRESH_SCRIPT } from '../src/setup-refresh-script.mjs';
import { discoverSetupOptions } from '../src/setup-discovery.mjs';

function result({ ok = true, stdout = '', stderr = '' } = {}) {
  return { ok, stdout, stderr, exitCode: ok ? 0 : 1 };
}

function fakeRunner(responses, calls = []) {
  return (command, args) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    return responses[key] || result({ ok: false, stderr: `Unexpected command: ${key}` });
  };
}

test('normal setup discovery is shallow and does not enumerate provider models', () => {
  const calls = [];
  const runner = fakeRunner({
    'git branch --show-current': result({ stdout: 'main' }),
    'git for-each-ref --format=%(refname:short) refs/heads': result({ stdout: 'main' }),
    'git for-each-ref --format=%(refname:short) refs/remotes/origin': result({ stdout: 'origin/main' }),
  }, calls);
  const options = discoverSetupOptions('/repo', {
    runner,
    includeCatalog: false,
    paseoOverride: {
      reachable: true,
      method: 'test',
      message: 'reachable',
      status: {},
      attempts: [],
    },
  });
  assert.equal(options.catalog.skipped, true);
  assert.equal(calls.some((call) => call.includes('provider ls')), false);
  assert.equal(calls.some((call) => call.includes('provider models')), false);
});

test('refresh recovery script renders visible placeholders and always has timeout escapes', () => {
  assert.match(SETUP_REFRESH_SCRIPT, /Waiting for the first check/);
  assert.match(SETUP_REFRESH_SCRIPT, /Checking requirements now/);
  assert.match(SETUP_REFRESH_SCRIPT, /Refreshing setup data/);
  assert.match(SETUP_REFRESH_SCRIPT, /AbortController/);
  assert.match(SETUP_REFRESH_SCRIPT, /catalogRefresh \? 25_000 : 12_000/);
  assert.match(SETUP_REFRESH_SCRIPT, /No button will remain stuck/);
  assert.match(SETUP_REFRESH_SCRIPT, /button\.disabled = false/);
});

test('refresh recovery script gives requirements and catalog buttons distinct modes', () => {
  assert.match(SETUP_REFRESH_SCRIPT, /requirements-check-again', 'Check again', 'requirements'/);
  assert.match(SETUP_REFRESH_SCRIPT, /refresh-setup-options', 'Refresh branches and models', 'catalog'/);
  assert.match(SETUP_REFRESH_SCRIPT, /requirement-details-recheck', 'Check again', 'requirements'/);
  assert.match(SETUP_REFRESH_SCRIPT, /refreshValue = catalogRefresh \? 'setup' : 'requirements'/);
});
