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

test('--help is the only top-level help command', async () => {
  const calls = [];
  await dispatchCli(['--help'], {
    managerCommand: async () => { calls.push('manager'); },
    helpCommand: () => { calls.push('help'); },
  });
  assert.deepEqual(calls, ['help']);

  await assert.rejects(
    dispatchCli(['--help', 'extra'], {
      managerCommand: async () => { calls.push('manager'); },
      helpCommand: () => { calls.push('help'); },
    }),
    /does not accept additional arguments/,
  );
});

test('retired help and manager aliases fail before repository routing', async () => {
  for (const args of [
    ['help'],
    ['-h'],
    ['manager'],
    ['manager', '--open'],
  ]) {
    const calls = [];
    await assert.rejects(
      dispatchCli(args, {
        managerCommand: async () => { calls.push('manager'); },
        repositoryCommand: async () => { calls.push('repository'); },
        mainCommand: async () => { calls.push('main'); },
        helpCommand: () => { calls.push('help'); },
      }),
      args[0] === 'manager'
        ? /Run paseo-issue-automation with no arguments/
        : /Use paseo-issue-automation --help/,
    );
    assert.deepEqual(calls, []);
  }
});
