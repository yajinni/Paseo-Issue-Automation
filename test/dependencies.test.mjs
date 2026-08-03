import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dependencyNumbers,
  detectDependencyCycles,
  evaluateIssueDependencies,
  executionWaves,
} from '../src/dependencies.mjs';

test('native dependencies are the only dependency source', () => {
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
    unavailable: false,
    reason: null,
  });
});

test('issue-body dependency text is never used as a fallback', () => {
  const result = dependencyNumbers({ body: 'Blocked by #12\nDepends on #13' });
  assert.equal(result.source, 'native');
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.numbers, []);
  assert.match(result.reason, /will not infer dependencies from issue-body text/i);
});

test('missing native relationship data blocks execution', () => {
  const result = evaluateIssueDependencies('/repo', { body: 'Depends on #7' }, { baseBranch: 'main' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.dependencies, []);
  assert.match(result.unresolved[0], /native github blocked-by relationship data is unavailable/i);
});

test('dependency cycles are reported', () => {
  assert.deepEqual(detectDependencyCycles({ 1: [2], 2: [3], 3: [1], 4: [] }), [[1, 2, 3, 1]]);
});

test('execution waves preserve parallel work', () => {
  const result = executionWaves({ 100: [], 101: [100], 102: [100], 103: [101, 102] });
  assert.deepEqual(result, { waves: [[100], [101, 102], [103]], unresolved: [] });
});

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
