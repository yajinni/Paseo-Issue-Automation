import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { TOP_LEVEL_HELP } from '../src/top-level-help.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('top-level help works outside a repository without resolving Git context', async () => {
  const calls = [];
  const value = await dispatchCli(['help'], {
    cwd: '/not-a-repository',
    runner: () => { throw new Error('Git resolution must not run for help.'); },
    helpCommand: () => { calls.push('help'); return TOP_LEVEL_HELP; },
  });
  assert.deepEqual(calls, ['help']);
  assert.equal(value, TOP_LEVEL_HELP);
  assert.match(value, /manager \[--open\]/);
  assert.match(value, /repo add \[PATH\]/);
  assert.match(value, /--repo ID\|OWNER\/REPO\|PATH/);
  assert.match(value, /127\.0\.0\.1:4318/);
});

test('empty invocation and help aliases use top-level help', async () => {
  for (const args of [[], ['--help'], ['-h']]) {
    let called = 0;
    await dispatchCli(args, {
      helpCommand: () => { called += 1; },
      runner: () => { throw new Error('Repository lookup should not run.'); },
    });
    assert.equal(called, 1);
  }
});

test('standalone manager documentation covers the complete managed lifecycle', () => {
  const documentation = read('../docs/STANDALONE_MANAGER.md');
  for (const phrase of [
    'npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>',
    'paseo-issue-automation repo add',
    'paseo-issue-automation manager --open',
    'Install for standalone manager',
    'Create migration PR',
    'Repair managed components',
    'Create removal PR',
    'Reconcile removal PR',
    '127.0.0.1:4318',
  ]) assert.match(documentation, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(documentation, /does not need `paseo-issue-automation` in `package\.json`/);
  assert.match(documentation, /Modified or user-owned files, labels, and workspaces are never deleted automatically/);
});

test('README recommends external manager and distinguishes legacy embedded mode', () => {
  const readme = read('../README.md');
  assert.match(readme, /Recommended architecture/);
  assert.match(readme, /External repository installation/);
  assert.match(readme, /Embedded installation migration/);
  assert.match(readme, /External repair and removal/);
  assert.match(readme, /Legacy per-repository control center/);
  assert.match(readme, /ordinary controller updates do not modify managed repository manifests or lockfiles/);
});
