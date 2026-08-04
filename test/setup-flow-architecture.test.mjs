import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { requirementState } from '../src/setup-requirements.mjs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('setup command opens directly on the Settings view', () => {
  const cli = source('src/cli.mjs');
  const server = source('src/server.mjs');
  assert.match(cli, /startServer\(\{ open: true, initialView: 'settings' \}\)/);
  assert.match(server, /initialView \? `\$\{url\}#\$\{encodeURIComponent\(initialView\)\}` : url/);
});

test('server exposes one bounded endpoint per setup requirement', () => {
  const server = source('src/server.mjs');
  assert.match(server, /url\.pathname === '\/api\/setup\/requirement'/);
  assert.match(server, /checkSetupRequirement\(root, name/);
  assert.match(server, /force: url\.searchParams\.get\('refresh'\) === '1'/);
});

test('setup snapshots no longer invoke the slow legacy snapshot builder', () => {
  const install = source('src/install.mjs');
  assert.match(install, /buildSetupSnapshot/);
  assert.match(install, /setupRequirements/);
  assert.doesNotMatch(install, /legacy\.setupSnapshot/);
});

test('automation issue loading is skipped until setup is operational', () => {
  const server = source('src/server.mjs');
  assert.match(server, /snapshot\.config\.setupComplete && snapshot\.checks\.ready/);
});

test('requirement states preserve useful passing and failing messages', () => {
  assert.deepEqual(requirementState('git', { git: true }), {
    ok: true,
    value: 'Installed and repository detected',
  });
  assert.deepEqual(requirementState('paseoReachable', {
    paseoReachable: false,
    paseoMessage: 'daemon did not answer',
  }), {
    ok: false,
    value: 'daemon did not answer',
  });
  assert.deepEqual(requirementState('remote', { remote: 'https://github.com/example/repo.git' }), {
    ok: true,
    value: 'https://github.com/example/repo.git',
  });
});
