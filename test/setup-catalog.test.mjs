import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverPaseoCatalog } from '../src/setup-catalog.mjs';

function result({ ok = true, stdout = '', stderr = '', timedOut = false, timeoutMs = 0 } = {}) {
  return {
    ok,
    stdout,
    stderr,
    timedOut,
    timeoutMs,
    exitCode: ok ? 0 : 1,
  };
}

function fakeRunner(responses, calls = []) {
  return (command, args) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    return responses[key] || result({ ok: false, stderr: `Unexpected command: ${key}` });
  };
}

test('disabled Claude does not hide a healthy OpenCode harness', () => {
  const calls = [];
  const runner = fakeRunner({
    'paseo provider ls --json': result({ stdout: JSON.stringify({
      type: 'list',
      data: [
        { provider: 'claude', label: 'Claude', status: 'unavailable', enabled: 'Disabled' },
        { provider: 'codex', label: 'Codex', status: 'unavailable', enabled: 'Enabled' },
        { provider: 'opencode', label: 'OpenCode', status: 'available', enabled: 'Enabled' },
      ],
    }) }),
    'paseo provider models opencode --thinking --json': result({ stdout: JSON.stringify({
      type: 'list',
      data: [
        { id: 'openai/gpt-5.4', model: 'GPT-5.4', description: 'Coding model' },
      ],
    }) }),
    'paseo provider models codex --thinking --json': result({
      ok: false,
      stderr: 'Codex CLI is not authenticated.',
    }),
  }, calls);

  const catalog = discoverPaseoCatalog('/repo', { runner });

  assert.deepEqual(calls, [
    'paseo provider ls --json',
    'paseo provider models opencode --thinking --json',
    'paseo provider models codex --thinking --json',
  ]);
  assert.equal(catalog.providers[0].id, 'opencode');
  assert.deepEqual(catalog.providers[0].models.map((model) => model.value), [
    'opencode/openai/gpt-5.4',
  ]);
  assert.equal(catalog.errors.some((message) => message.startsWith('claude:')), false);
  assert.equal(catalog.errors.some((message) => message.startsWith('codex:')), true);
  assert.equal(catalog.diagnostics.some((message) => message.includes('claude')), true);
  assert.deepEqual(catalog.attemptedProviders, ['opencode', 'codex']);
});

test('failed model discovery keeps the enabled harness visible with its own error', () => {
  const runner = fakeRunner({
    'paseo provider ls --json': result({ stdout: JSON.stringify({
      type: 'list',
      data: [
        { provider: 'opencode', label: 'OpenCode', status: 'loading', enabled: 'Enabled' },
      ],
    }) }),
    'paseo provider models opencode --thinking --json': result({
      ok: false,
      stderr: 'OpenCode model discovery timed out.',
    }),
  });

  const catalog = discoverPaseoCatalog('/repo', { runner });

  assert.equal(catalog.providers.length, 1);
  assert.equal(catalog.providers[0].id, 'opencode');
  assert.deepEqual(catalog.providers[0].models, []);
  assert.match(catalog.providers[0].error, /OpenCode model discovery timed out/);
  assert.match(catalog.errors[0], /^opencode:/);
});

test('no enabled providers reports the complete provider state instead of one unrelated provider', () => {
  const runner = fakeRunner({
    'paseo provider ls --json': result({ stdout: JSON.stringify({
      type: 'list',
      data: [
        { provider: 'claude', status: 'unavailable', enabled: 'Disabled' },
        { provider: 'opencode', status: 'unavailable', enabled: 'Disabled' },
      ],
    }) }),
  });

  const catalog = discoverPaseoCatalog('/repo', { runner });

  assert.equal(catalog.providers.length, 0);
  assert.match(catalog.errors[0], /no enabled providers/i);
  assert.match(catalog.errors[0], /claude/);
  assert.match(catalog.errors[0], /opencode/);
});
