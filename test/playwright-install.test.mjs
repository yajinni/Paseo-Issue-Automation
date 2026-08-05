import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  playwrightCommand,
  playwrightInstallArgs,
  playwrightSpawnInvocation,
  systemNpxEnvironment,
} from '../src/browser-service.mjs';

test('Playwright is a required project dependency', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.dependencies.playwright, '^1.61.1');
  assert.equal(packageJson.optionalDependencies, undefined);
});

test('Chromium installation uses Playwright standard commands', () => {
  assert.equal(playwrightCommand('win32'), 'npx.cmd');
  assert.equal(playwrightCommand('darwin'), 'npx');
  assert.equal(playwrightCommand('linux'), 'npx');
  assert.deepEqual(playwrightInstallArgs('win32'), ['playwright', 'install', 'chromium']);
  assert.deepEqual(playwrightInstallArgs('darwin'), ['playwright', 'install', 'chromium']);
  assert.deepEqual(playwrightInstallArgs('linux'), ['playwright', 'install', '--with-deps', 'chromium']);
});

test('system npx environment canonicalizes duplicate Windows Path variables', () => {
  const env = {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    Path: 'C:\\Windows\\System32',
    PATH: [
      'C:\\Users\\Yajinni\\Documents\\Coding Projects\\JuliesDashboard\\node_modules\\.bin',
      'C:\\Program Files\\nodejs',
      'C:\\Windows\\System32',
    ].join(';'),
    KEEP_ME: 'yes',
  };

  const clean = systemNpxEnvironment(env, 'win32');
  assert.deepEqual(
    Object.keys(clean).filter((key) => key.toLowerCase() === 'path'),
    ['Path'],
  );
  assert.equal(clean.Path, 'C:\\Program Files\\nodejs;C:\\Windows\\System32');
  assert.equal(clean.KEEP_ME, 'yes');
  assert.match(env.PATH, /node_modules\\\.bin/i);
});

test('Windows Playwright commands resolve an absolute system npx through cmd.exe', () => {
  const env = {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    Path: 'C:\\Windows\\System32',
    PATH: [
      'C:\\repo\\node_modules\\.bin',
      'C:\\Program Files\\nodejs',
      'C:\\Windows\\System32',
    ].join(';'),
  };
  let resolverEnvironment = null;
  const invocation = playwrightSpawnInvocation(
    ['playwright', 'install', 'chromium'],
    {
      platform: 'win32',
      env,
      resolve(command, options) {
        assert.equal(command, 'npx.cmd');
        assert.equal(options.platform, 'win32');
        resolverEnvironment = options.env;
        return {
          available: true,
          path: 'C:\\Program Files\\nodejs\\npx.cmd',
          source: 'path',
        };
      },
    },
  );
  assert.equal(invocation.executable, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);
  assert.equal(
    invocation.args[4],
    'call "C:\\Program Files\\nodejs\\npx.cmd" "playwright" "install" "chromium"',
  );
  assert.equal(invocation.resolvedCommand, 'C:\\Program Files\\nodejs\\npx.cmd');
  assert.equal(invocation.env.Path, 'C:\\Program Files\\nodejs;C:\\Windows\\System32');
  assert.equal(invocation.env.PATH, undefined);
  assert.equal(resolverEnvironment, invocation.env);
  assert.equal(invocation.windowsVerbatimArguments, true);

  const linux = playwrightSpawnInvocation(
    ['playwright', 'install', '--with-deps', 'chromium'],
    { platform: 'linux', env: { PATH: '/repo/node_modules/.bin:/usr/local/bin:/usr/bin' } },
  );
  assert.equal(linux.executable, 'npx');
  assert.deepEqual(linux.args, ['playwright', 'install', '--with-deps', 'chromium']);
  assert.equal(linux.env.PATH, '/usr/local/bin:/usr/bin');
  assert.equal(linux.resolvedCommand, 'npx');
  assert.equal(linux.windowsVerbatimArguments, false);
});

test('Windows Playwright commands fail clearly when system npx is unavailable', () => {
  assert.throws(
    () => playwrightSpawnInvocation(
      ['playwright', 'install', 'chromium'],
      {
        platform: 'win32',
        env: { Path: 'C:\\Windows\\System32' },
        resolve: () => ({ available: false, path: null, source: 'missing' }),
      },
    ),
    /System npx\.cmd is unavailable/,
  );
});

test('browser service verifies Chromium executable state around install and uninstall', () => {
  const source = readFileSync(new URL('../src/browser-service.mjs', import.meta.url), 'utf8');
  assert.match(source, /export function playwrightChromiumStatus/);
  assert.match(source, /Chromium install command completed, but no browser executable was found/);
  assert.match(source, /Chromium uninstall command completed, but the browser executable still exists/);
  assert.match(source, /Close the dedicated ChatGPT browser before uninstalling Chromium/);
  assert.match(source, /command: \[playwrightCommand\(platform\), \.\.\.args\]/);
  assert.match(source, /resolvedCommand: result\.resolvedCommand/);
});

test('browser service keeps npx and does not resolve Playwright internal CLI files', () => {
  const source = readFileSync(new URL('../src/browser-service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /playwright-core/);
  assert.doesNotMatch(source, /require\.resolve\(['"]playwright[^'"]*\/cli/);
  assert.match(source, /import\('playwright'\)/);
  assert.match(source, /\['playwright', 'install', '--with-deps', 'chromium'\]/);
  assert.match(source, /buildWindowsCmdInvocation/);
  assert.match(source, /resolveCommand/);
  assert.match(source, /systemNpxEnvironment/);
  assert.match(source, /playwrightCommand\(platform\)/);
});
