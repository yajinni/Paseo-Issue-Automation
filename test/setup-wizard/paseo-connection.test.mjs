import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPaseoConnectionContext,
  discoverPaseoConnection,
  paseoHostCandidates,
  probePaseoConnection,
  redactSensitive,
} from '../../src/setup-wizard/paseo-connection.mjs';

test('Paseo context sends one host to every command and password only through the environment', () => {
  const calls = [];
  const password = 'correct horse battery staple';
  const fakeRun = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({ value: password }),
      stderr: '',
      resolvedCommand: '/usr/bin/paseo',
      resolutionSource: 'path',
    };
  };
  const fakeRunJson = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return { daemonVersion: '2.4.0', accidentalPasswordEcho: password };
  };
  const context = createPaseoConnectionContext({
    host: 'localhost:6767',
    password,
    env: { PATH: '/bin', PASEO_PASSWORD: 'old-value' },
    run: fakeRun,
    runJson: fakeRunJson,
  });

  const text = context.command(['workspace', 'ls', '--json']);
  const json = context.json(['daemon', 'status', '--json']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.env.PASEO_HOST, 'localhost:6767');
    assert.equal(call.env.PASEO_PASSWORD, password);
    assert.equal(call.args.some((arg) => String(arg).includes(password)), false);
    assert.equal(call.args.some((arg) => /password=/i.test(String(arg))), false);
  }
  assert.equal(JSON.stringify(text).includes(password), false);
  assert.equal(JSON.stringify(json).includes(password), false);
});

test('redaction removes password values, password query parameters, and authorization data recursively', () => {
  const secret = 'super-secret';
  const result = redactSensitive({
    url: `tcp://localhost:6767?password=${secret}`,
    stderr: `Authorization: Bearer ${secret}`,
    nested: { password: secret, note: `failed with ${secret}` },
  }, [secret]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.match(result.url, /password=\[REDACTED\]/);
  assert.equal(result.nested.password, '[REDACTED]');
});

test('automatic host discovery is stable and manual host is tried only after automatic candidates fail', () => {
  assert.deepEqual(paseoHostCandidates({ savedHost: '10.0.0.5:6767', containerized: false }), [
    '10.0.0.5:6767',
    '127.0.0.1:6767',
    'localhost:6767',
  ]);

  const tried = [];
  const result = discoverPaseoConnection({
    savedHost: '10.0.0.5:6767',
    manualHost: '10.0.0.9:6767',
    contextFactory: ({ host }) => ({ host, authenticated: false }),
    probe: (context) => {
      tried.push(context.host);
      return {
        ok: context.host === '10.0.0.9:6767',
        host: context.host,
        authentication: { required: false, supplied: false, ok: context.host === '10.0.0.9:6767' },
      };
    },
  });
  assert.equal(result.found, true);
  assert.deepEqual(tried, ['10.0.0.5:6767', '127.0.0.1:6767', 'localhost:6767', '10.0.0.9:6767']);
});

test('authentication failure keeps the detected host and never serializes the supplied password', () => {
  const password = 'wrong-password';
  const result = discoverPaseoConnection({
    savedHost: 'paseo.internal:6767',
    password,
    contextFactory: ({ host, password: supplied }) => ({ host, authenticated: Boolean(supplied) }),
    probe: (context) => ({
      ok: false,
      host: context.host,
      authentication: { required: true, supplied: context.authenticated, ok: false },
      diagnostic: { stderr: '401 Unauthorized' },
    }),
  });
  assert.equal(result.found, false);
  assert.equal(result.needsAuthentication, true);
  assert.equal(result.result.host, 'paseo.internal:6767');
  assert.equal(JSON.stringify(result).includes(password), false);
});

test('CLI and daemon versions are represented independently by the connection probe', () => {
  const context = {
    host: 'localhost:6767',
    authenticated: true,
    json: () => ({ version: 'daemon-9.1' }),
    command: () => ({ ok: true, exitCode: 0, stdout: '[]', stderr: '', resolvedCommand: '/bin/paseo' }),
  };
  const result = probePaseoConnection(context, {
    run: () => ({ ok: true, stdout: 'paseo-cli 8.2', stderr: '', resolvedCommand: '/bin/paseo' }),
  });
  assert.equal(result.cli.version, 'paseo-cli 8.2');
  assert.equal(result.daemon.version, 'daemon-9.1');
  assert.equal(result.ok, true);
});
