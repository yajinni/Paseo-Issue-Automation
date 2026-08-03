import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dependencyNumbers,
  detectDependencyCycles,
  executionWaves,
  parseBodyDependencies,
} from '../src/dependencies.mjs';

test('native dependencies are authoritative over body fallback', () => {
  const issue = {
    body: 'Blocked by #99',
    blockedBy: [{ number: 12, title: 'Foundation', state: 'OPEN' }],
  };
  assert.deepEqual(dependencyNumbers(issue), {
    source: 'native',
    numbers: [12],
    dependencies: [{
      number: 12,
      title: 'Foundation',
      state: 'OPEN',
      stateReason: '',
      url: null,
      closedByPullRequestsReferences: [],
    }],
  });
});

test('body dependencies remain a compatibility fallback', () => {
  assert.deepEqual(parseBodyDependencies('Blocked by #12\nDepends on #13\nBlocked by #12'), [12, 13]);
  assert.deepEqual(dependencyNumbers({ body: 'Depends on #7' }), {
    source: 'body-fallback',
    numbers: [7],
    dependencies: [],
  });
});

test('dependency cycles are reported', () => {
  assert.deepEqual(detectDependencyCycles({ 1: [2], 2: [3], 3: [1], 4: [] }), [[1, 2, 3, 1]]);
});

test('execution waves preserve parallel work', () => {
  const result = executionWaves({ 100: [], 101: [100], 102: [100], 103: [101, 102] });
  assert.deepEqual(result, { waves: [[100], [101, 102], [103]], unresolved: [] });
});

import { evaluateIssueDependencies } from '../src/dependencies.mjs';

test('closed coding dependencies require a merged PR present in the base branch', () => {
  const issue = {
    number: 20,
    body: '',
    blockedBy: [{ number: 10, title: 'Foundation', state: 'CLOSED' }],
  };
  const jsonRunner = (command, args) => {
    const joined = args.join(' ');
    if (joined.includes('issue view 10')) {
      return {
        number: 10,
        title: 'Foundation',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        closedByPullRequestsReferences: [{ number: 55 }],
      };
    }
    if (joined.includes('pr view 55')) {
      return {
        number: 55,
        mergedAt: '2026-08-03T00:00:00Z',
        baseRefName: 'main',
        mergeCommit: { oid: 'abc' },
      };
    }
    return null;
  };
  const runner = (command, args) => {
    if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'merge-base') return { ok: true, stdout: '', stderr: '' };
    return { ok: false, stdout: '', stderr: '' };
  };
  const result = evaluateIssueDependencies('/repo', issue, { baseBranch: 'main' }, { jsonRunner, runner });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].prNumber, 55);
});

test('closed without merged implementation does not unlock downstream work', () => {
  const issue = {
    number: 20,
    body: '',
    blockedBy: [{ number: 10, title: 'Foundation', state: 'CLOSED' }],
  };
  const jsonRunner = (command, args) => {
    if (args.join(' ').includes('issue view 10')) {
      return {
        number: 10,
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        closedByPullRequestsReferences: [],
      };
    }
    return null;
  };
  const runner = (command, args) => args[0] === 'fetch'
    ? { ok: true, stdout: '', stderr: '' }
    : { ok: false, stdout: '', stderr: '' };
  const result = evaluateIssueDependencies('/repo', issue, { baseBranch: 'main' }, { jsonRunner, runner });
  assert.equal(result.ok, false);
  assert.match(result.unresolved[0], /no merged pull request/i);
});
