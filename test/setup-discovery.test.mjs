import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverBranches,
  discoverPaseoCatalog,
  parseJsonOutput,
  probePaseo,
} from '../src/setup-discovery.mjs';

function result({ ok = true, stdout = '', stderr = '' } = {}) {
  return { ok, stdout, stderr, exitCode: ok ? 0 : 1 };
}

function commandKey(command, args) {
  return [command, ...args].join(' ');
}

function fakeRunner(responses, calls = []) {
  return (command, args) => {
    const key = commandKey(command, args);
    calls.push(key);
    return responses[key] || result({ ok: false, stderr: `Unexpected command: ${key}` });
  };
}

test('JSON parser tolerates a warning before structured Paseo output', () => {
  assert.deepEqual(parseJsonOutput('warning: old config\n{"connectedDaemon":"reachable"}'), {
    connectedDaemon: 'reachable',
  });
});

test('Paseo reachability uses parsed daemon status instead of workspace-list exit status', () => {
  const calls = [];
  const runner = fakeRunner({
    'paseo daemon status --json': result({ stdout: JSON.stringify({ connectedDaemon: 'reachable', daemonVersion: '1.2.3' }) }),
  }, calls);
  const probe = probePaseo('/repo', { runner });
  assert.equal(probe.reachable, true);
  assert.equal(probe.method, 'daemon-status');
  assert.match(probe.message, /1\.2\.3/);
  assert.deepEqual(calls, ['paseo daemon status --json']);
});

test('an explicit unreachable daemon status fails closed without a misleading fallback', () => {
  const calls = [];
  const runner = fakeRunner({
    'paseo daemon status --json': result({ stdout: JSON.stringify({ connectedDaemon: 'unreachable', note: 'websocket did not answer' }) }),
    'paseo workspace ls --json': result({ stdout: '[]' }),
  }, calls);
  const probe = probePaseo('/repo', { runner });
  assert.equal(probe.reachable, false);
  assert.match(probe.message, /unreachable/);
  assert.deepEqual(calls, ['paseo daemon status --json']);
});

test('older Paseo versions may use a structured compatibility probe', () => {
  const calls = [];
  const runner = fakeRunner({
    'paseo daemon status --json': result({ ok: false, stderr: 'unknown command daemon' }),
    'paseo workspace ls --json': result({ stdout: '[]' }),
  }, calls);
  const probe = probePaseo('/repo', { runner });
  assert.equal(probe.reachable, true);
  assert.equal(probe.method, 'compat-workspace');
  assert.deepEqual(calls, ['paseo daemon status --json', 'paseo workspace ls --json']);
});

test('branch discovery combines local and origin branches and marks the current branch', () => {
  const runner = fakeRunner({
    'git branch --show-current': result({ stdout: 'rewrite/openspec-baseline' }),
    'git for-each-ref --format=%(refname:short) refs/heads': result({ stdout: 'main\nrewrite/openspec-baseline\n' }),
    'git for-each-ref --format=%(refname:short) refs/remotes/origin': result({ stdout: 'origin/HEAD\norigin/main\norigin/rewrite/openspec-baseline\norigin/release\n' }),
  });
  const discovered = discoverBranches('/repo', { runner });
  assert.equal(discovered.current, 'rewrite/openspec-baseline');
  assert.deepEqual(discovered.branches.map((branch) => branch.name), [
    'rewrite/openspec-baseline',
    'main',
    'release',
  ]);
  assert.deepEqual(discovered.branches[0], {
    name: 'rewrite/openspec-baseline', local: true, remote: true, current: true,
  });
});

test('provider and model discovery returns only enabled available Paseo harnesses', () => {
  const calls = [];
  const runner = fakeRunner({
    'paseo provider ls --json': result({ stdout: JSON.stringify([
      { provider: 'opencode', label: 'OpenCode', status: 'available', enabled: 'Enabled' },
      { provider: 'codex', label: 'Codex', status: 'unavailable', enabled: 'Enabled' },
      { provider: 'claude', label: 'Claude', status: 'available', enabled: 'Disabled' },
    ]) }),
    'paseo provider models opencode --json': result({ stdout: JSON.stringify([
      { id: 'openai/gpt-5.4', model: 'GPT-5.4', description: 'Coding model' },
      { id: 'xai/grok-code', model: 'Grok Code' },
    ]) }),
  }, calls);
  const catalog = discoverPaseoCatalog('/repo', { runner });
  assert.deepEqual(catalog.providers.map((provider) => provider.id), ['opencode']);
  assert.deepEqual(catalog.providers[0].models.map((model) => model.value), [
    'opencode/openai/gpt-5.4',
    'opencode/xai/grok-code',
  ]);
  assert.deepEqual(calls, [
    'paseo provider ls --json',
    'paseo provider models opencode --json',
  ]);
});
