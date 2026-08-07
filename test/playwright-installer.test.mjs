import assert from 'node:assert/strict';
import test from 'node:test';
import { installPlaywrightLibrary, npmInstallInvocation } from '../src/playwright-installer.mjs';

test('Playwright repair is a no-op when the library is already installed', () => {
  const result = installPlaywrightLibrary({
    libraryStatus: () => ({ installed: true, modulePath: '/tmp/playwright/index.js' }),
    spawn: () => { throw new Error('spawn should not run'); },
  });
  assert.equal(result.installed, true);
  assert.equal(result.alreadyInstalled, true);
});

test('Playwright repair installs Paseo runtime dependencies and verifies the library afterward', () => {
  let checks = 0;
  let invocation = null;
  const result = installPlaywrightLibrary({
    platform: 'linux',
    packageRoot: '/tmp/paseo',
    libraryStatus: () => (++checks === 1
      ? { installed: false, modulePath: null }
      : { installed: true, modulePath: '/tmp/paseo/node_modules/playwright/index.js' }),
    resolve: () => ({ available: true, path: '/usr/bin/npm' }),
    spawn: (executable, args, options) => {
      invocation = { executable, args, options };
      return { status: 0, stdout: 'installed', stderr: '' };
    },
  });
  assert.equal(result.installed, true);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(invocation.executable, '/usr/bin/npm');
  assert.deepEqual(invocation.args.slice(0, 2), ['install', '--omit=dev']);
  assert.equal(invocation.options.cwd, '/tmp/paseo');
});

test('Windows Playwright repair invokes npm.cmd through cmd.exe safely', () => {
  const invocation = npmInstallInvocation(['install', '--omit=dev'], {
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    resolve: () => ({ available: true, path: 'C:\\Program Files\\nodejs\\npm.cmd' }),
  });
  assert.equal(invocation.executable, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(invocation.windowsVerbatimArguments, true);
  assert.match(invocation.args.at(-1), /npm\.cmd/);
});
