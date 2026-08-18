import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  dependencyNumbers,
  detectDependencyCycles,
  evaluateIssueDependencies,
  executionWaves,
  commitIsInBase,
  refreshBase,
  relationshipNodes,
} from '../src/dependencies.mjs';

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.error, undefined, `git ${args.join(' ')} failed to start`);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout || '').trim();
}

function configureGit(cwd) {
  runGit(cwd, ['config', 'user.name', 'Paseo Tests']);
  runGit(cwd, ['config', 'user.email', 'paseo-tests@example.test']);
}

test('native dependencies accept the GitHub CLI connection shape', () => {
  const issue = {
    body: 'Blocked by #99',
    blockedBy: {
      nodes: [{ number: 12, title: 'Foundation', state: 'OPEN' }],
      totalCount: 1,
    },
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

test('legacy array relationship fixtures remain supported', () => {
  assert.deepEqual(relationshipNodes([{ number: 12 }]), [{ number: 12 }]);
  assert.deepEqual(dependencyNumbers({ blockedBy: [{ number: 12 }] }).numbers, [12]);
});

test('an empty GitHub CLI relationship connection is available with no dependencies', () => {
  const result = dependencyNumbers({ blockedBy: { nodes: [], totalCount: 0 } });
  assert.equal(result.unavailable, false);
  assert.deepEqual(result.numbers, []);
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

test('refreshBase fetches the exact remote ref without pruning and verifies it', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'show-ref') return { ok: true, stdout: '', stderr: '' };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };

  const result = refreshBase('/repo', 'release/candidate', { runner });

  assert.deepEqual(result, {
    ok: true,
    remoteRef: 'refs/remotes/origin/release/candidate',
    detail: null,
  });
  assert.deepEqual(calls.map(([, args]) => args), [
    ['fetch', 'origin', '+refs/heads/release/candidate:refs/remotes/origin/release/candidate'],
    ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/release/candidate'],
  ]);
});

test('refreshBase fails closed when fetch fails or the exact ref is missing', () => {
  let verifyCalls = 0;
  const fetchFailure = refreshBase('/repo', 'main', {
    runner: (command, args) => {
      assert.equal(command, 'git');
      assert.equal(args[0], 'fetch');
      return { ok: false, stdout: '', stderr: 'remote branch is missing' };
    },
  });
  assert.equal(fetchFailure.ok, false);
  assert.equal(fetchFailure.remoteRef, 'refs/remotes/origin/main');

  const missingRef = refreshBase('/repo', 'main', {
    runner: (command, args) => {
      assert.equal(command, 'git');
      if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
      verifyCalls += 1;
      return { ok: false, stdout: '', stderr: '' };
    },
  });
  assert.equal(missingRef.ok, false);
  assert.equal(verifyCalls, 1);
});

test('real local Git refresh preserves ancestry, advances tracking refs, supports non-main bases, and fails closed', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-dependencies-'));
  const origin = path.join(tempRoot, 'origin.git');
  const worker = path.join(tempRoot, 'worker');
  const issue313MergeCommit = 'e21a70e9a0954bfd6e812daffe0669a1939aeef0';
  const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

  try {
    runGit(tempRoot, ['init', '--bare', '--initial-branch=main', origin]);
    runGit(repositoryRoot, [
      'push', origin, 'HEAD:refs/heads/main', 'HEAD:refs/heads/release',
    ]);
    runGit(tempRoot, ['clone', origin, worker]);
    configureGit(worker);

    const initialMainSha = runGit(worker, ['rev-parse', 'refs/remotes/origin/main']);
    assert.equal(runGit(worker, ['merge-base', '--is-ancestor', issue313MergeCommit, 'refs/remotes/origin/main']), '');
    assert.equal(initialMainSha.length, 40);

    writeFileSync(path.join(worker, 'refresh-regression.txt'), 'advanced base\n');
    runGit(worker, ['add', 'refresh-regression.txt']);
    runGit(worker, ['commit', '-m', 'Advance dependency base']);
    const advancedMainSha = runGit(worker, ['rev-parse', 'HEAD']);
    runGit(worker, ['push', 'origin', 'HEAD:refs/heads/main']);
    runGit(worker, ['update-ref', 'refs/remotes/origin/main', initialMainSha]);

    const refreshedMain = refreshBase(worker, 'main');
    assert.equal(refreshedMain.ok, true);
    assert.equal(runGit(worker, ['rev-parse', refreshedMain.remoteRef]), advancedMainSha);
    assert.notEqual(initialMainSha, advancedMainSha);
    assert.equal(commitIsInBase(worker, issue313MergeCommit, refreshedMain.remoteRef), true);

    const refreshedRelease = refreshBase(worker, 'release');
    assert.equal(refreshedRelease.ok, true);
    assert.equal(commitIsInBase(worker, issue313MergeCommit, refreshedRelease.remoteRef), true);

    const issue = {
      number: 317,
      blockedBy: {
        nodes: [{ number: 313, title: 'Manual imports', state: 'CLOSED' }],
        totalCount: 1,
      },
    };
    const jsonRunner = (command, args) => {
      assert.equal(command, 'gh');
      if (args[0] === 'issue') {
        return {
          number: 313,
          state: 'CLOSED',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [{ number: 316 }],
        };
      }
      return {
        number: 316,
        mergedAt: '2026-08-18T00:00:00Z',
        baseRefName: 'main',
        mergeCommit: { oid: issue313MergeCommit },
      };
    };
    const accepted = evaluateIssueDependencies(worker, issue, { baseBranch: 'main' }, { jsonRunner });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.results[0].mergeCommit, issue313MergeCommit);
    const nonMainAccepted = evaluateIssueDependencies(worker, issue, { baseBranch: 'release' }, {
      jsonRunner: (command, args) => command === 'gh' && args[0] === 'issue'
        ? {
          number: 313,
          state: 'CLOSED',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [{ number: 316 }],
        }
        : {
          number: 316,
          mergedAt: '2026-08-18T00:00:00Z',
          baseRefName: 'release',
          mergeCommit: { oid: issue313MergeCommit },
        },
    });
    assert.equal(nonMainAccepted.ok, true);

    runGit(worker, ['checkout', '-b', 'not-in-main']);
    writeFileSync(path.join(worker, 'unmerged-regression.txt'), 'not in main\n');
    runGit(worker, ['add', 'unmerged-regression.txt']);
    runGit(worker, ['commit', '-m', 'Create unmerged dependency candidate']);
    const unmergedCommit = runGit(worker, ['rev-parse', 'HEAD']);
    runGit(worker, ['push', 'origin', 'HEAD:refs/heads/not-in-main']);
    const rejected = evaluateIssueDependencies(worker, issue, { baseBranch: 'main' }, {
      jsonRunner: (command, args) => command === 'gh' && args[0] === 'issue'
        ? {
          number: 313,
          state: 'CLOSED',
          stateReason: 'COMPLETED',
          closedByPullRequestsReferences: [{ number: 317 }],
        }
        : {
          number: 317,
          mergedAt: '2026-08-18T00:00:00Z',
          baseRefName: 'main',
          mergeCommit: { oid: unmergedCommit },
        },
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.unresolved[0], /not present in main/i);

    runGit(tempRoot, ['--git-dir', origin, 'update-ref', '-d', 'refs/heads/main']);
    const staleMainSha = runGit(worker, ['rev-parse', 'refs/remotes/origin/main']);
    assert.equal(staleMainSha, advancedMainSha);
    const missingBase = refreshBase(worker, 'main');
    assert.equal(missingBase.ok, false);
    assert.equal(runGit(worker, ['rev-parse', 'refs/remotes/origin/main']), staleMainSha);
    const blockedByMissingBase = evaluateIssueDependencies(worker, issue, { baseBranch: 'main' }, { jsonRunner });
    assert.equal(blockedByMissingBase.ok, false);
    assert.match(blockedByMissingBase.unresolved[0], /could not refresh main/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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
    blockedBy: {
      nodes: [{ number: 10, title: 'Foundation', state: 'CLOSED' }],
      totalCount: 1,
    },
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
    if (args[0] === 'show-ref') return { ok: true, stdout: '', stderr: '' };
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
    blockedBy: {
      nodes: [{ number: 10, title: 'Foundation', state: 'CLOSED' }],
      totalCount: 1,
    },
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
    : args[0] === 'show-ref'
      ? { ok: true, stdout: '', stderr: '' }
    : { ok: false, stdout: '', stderr: '' };
  const result = evaluateIssueDependencies('/repo', issue, { baseBranch: 'main' }, { jsonRunner, runner });
  assert.equal(result.ok, false);
  assert.match(result.unresolved[0], /no merged pull request/i);
});
