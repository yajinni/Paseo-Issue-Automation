import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dispatchCli } from '../src/entrypoint.mjs';
import { TOP_LEVEL_HELP } from '../src/top-level-help.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('top-level --help works outside a repository without resolving Git context', async () => {
  const calls = [];
  const value = await dispatchCli(['--help'], {
    cwd: '/not-a-repository',
    runner: () => { throw new Error('Git resolution must not run for help.'); },
    helpCommand: () => { calls.push('help'); return TOP_LEVEL_HELP; },
  });
  assert.deepEqual(calls, ['help']);
  assert.equal(value, TOP_LEVEL_HELP);
  assert.match(value, /Standalone manager:\n  paseo-issue-automation\n  paseo-issue-automation --help/);
  assert.doesNotMatch(value, /manager \[--open\]/);
  assert.match(value, /repo add \[PATH\]/);
  assert.match(value, /--repo ID\|OWNER\/REPO\|PATH/);
  assert.match(value, /127\.0\.0\.1:4318/);
});

test('standalone manager documentation covers the complete managed lifecycle', () => {
  const documentation = read('../docs/STANDALONE_MANAGER.md');
  for (const phrase of [
    'npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>',
    'paseo-issue-automation --help',
    'paseo-issue-automation repo add',
    'The bare command starts the standalone manager and opens its dashboard',
    'Install for standalone manager',
    'Create migration PR',
    'Repair managed components',
    'Create removal PR',
    'Reconcile removal PR',
    '127.0.0.1:4318',
  ]) assert.match(documentation, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(documentation, /paseo-issue-automation manager(?: --open)?/);
  assert.match(documentation, /do not need `paseo-issue-automation` in `package\.json`/u);
  assert.match(documentation, /Modified or user-owned files, labels, and workspaces are never deleted automatically/);
});

test('README recommends external manager and documents only the supported launch and help forms', () => {
  const readme = read('../README.md');
  assert.match(readme, /Recommended architecture/);
  assert.match(readme, /External repository installation/);
  assert.match(readme, /Embedded installation migration/);
  assert.match(readme, /External repair and removal/);
  assert.match(readme, /Legacy per-repository control center/);
  assert.match(readme, /ordinary controller updates do not modify managed repository manifests or lockfiles/);
  assert.match(readme, /paseo-issue-automation --help/);
  assert.doesNotMatch(readme, /paseo-issue-automation help/);
  assert.doesNotMatch(readme, /paseo-issue-automation manager(?: --open)?/);
});
