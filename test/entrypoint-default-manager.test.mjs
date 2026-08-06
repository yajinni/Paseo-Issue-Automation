import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';

test('bare command starts the standalone manager and opens the dashboard', async () => {
  const calls = [];
  await dispatchCli([], {
    rootDir: 'C:/paseo-manager-state',
    managerCommand: async (options) => { calls.push(options); },
    helpCommand: () => { throw new Error('help should not run'); },
  });

  assert.deepEqual(calls, [{ open: true, rootDir: 'C:/paseo-manager-state' }]);
});

test('explicit help aliases still print help instead of starting the manager', async () => {
  for (const command of ['help', '--help', '-h']) {
    const calls = [];
    await dispatchCli([command], {
      managerCommand: async () => { calls.push('manager'); },
      helpCommand: () => { calls.push('help'); },
    });
    assert.deepEqual(calls, ['help']);
  }
});

test('explicit manager command keeps its existing browser-open behavior', async () => {
  const calls = [];
  await dispatchCli(['manager'], {
    managerCommand: async (options) => { calls.push(options); },
  });
  await dispatchCli(['manager', '--open'], {
    managerCommand: async (options) => { calls.push(options); },
  });

  assert.deepEqual(calls, [
    { open: false, rootDir: undefined },
    { open: true, rootDir: undefined },
  ]);
});
