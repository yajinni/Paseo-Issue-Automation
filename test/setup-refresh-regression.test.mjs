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

test('setup renders each pending requirement and updates it independently', () => {
  for (const id of ['git', 'githubCli', 'githubAuthenticated', 'paseoCli', 'paseoReachable', 'remote']) {
    assert.match(SETUP_REFRESH_SCRIPT, new RegExp(`id: '${id}'`));
  }
  assert.match(SETUP_REFRESH_SCRIPT, /setup-progress-/);
  assert.match(SETUP_REFRESH_SCRIPT, /updateProgressRow/);
  assert.match(SETUP_REFRESH_SCRIPT, /\/api\/setup\/requirement\?name=/);
  assert.match(SETUP_REFRESH_SCRIPT, /Checking now/);
  assert.match(SETUP_REFRESH_SCRIPT, /good-text/);
  assert.match(SETUP_REFRESH_SCRIPT, /bad-text/);
});

test('setup automatically runs catalog discovery after requirements pass', () => {
  assert.match(SETUP_REFRESH_SCRIPT, /progressiveRequirements\(null, true\)/);
  assert.match(SETUP_REFRESH_SCRIPT, /fullData\.setupOptions\.catalog\.skipped/);
  assert.match(SETUP_REFRESH_SCRIPT, /authoritativeRefresh\(document\.getElementById\('refresh-setup-options'\), 'catalog'\)/);
  assert.match(SETUP_REFRESH_SCRIPT, /\/api\/status\?refresh=setup/);
  assert.match(SETUP_REFRESH_SCRIPT, /40_000/);
});

test('catalog status distinguishes not-run, failed, partial, and successful discovery', () => {
  assert.match(SETUP_REFRESH_SCRIPT, /Harness and model discovery has not run yet/);
  assert.match(SETUP_REFRESH_SCRIPT, /no usable harnesses were loaded/);
  assert.match(SETUP_REFRESH_SCRIPT, /Some providers reported problems/);
  assert.match(SETUP_REFRESH_SCRIPT, /Loaded ' \+ branches \+ ' branches/);
});

test('requirements and catalog buttons remain distinct', () => {
  assert.match(SETUP_REFRESH_SCRIPT, /requirements-check-again', 'Check again', 'requirements'/);
  assert.match(SETUP_REFRESH_SCRIPT, /refresh-setup-options', 'Refresh branches and models', 'catalog'/);
  assert.match(SETUP_REFRESH_SCRIPT, /requirement-details-recheck', 'Check again', 'requirements'/);
});
