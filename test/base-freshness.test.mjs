import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectBaseFreshness } from '../src/base-freshness.mjs';

function commandResult({ ok = true, exitCode = ok ? 0 : 1, stdout = '', stderr = '' } = {}) {
  return { ok, exitCode, stdout, stderr, error: null };
}

function gitRunner({ ancestorExitCode = 0, ancestorStderr = '', behind = 0, ahead = 1 } = {}) {
  return (command, args) => {
    assert.equal(command, 'git');
    if (args[0] === 'fetch') return commandResult();
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return commandResult({ stdout: 'head-sha' });
    if (args[0] === 'rev-parse') return commandResult({ stdout: 'base-sha' });
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      return commandResult({
        ok: ancestorExitCode === 0,
        exitCode: ancestorExitCode,
        stderr: ancestorStderr,
      });
    }
    if (args[0] === 'merge-base') return commandResult({ stdout: ancestorExitCode === 0 ? 'base-sha' : 'older-merge-base' });
    if (args[0] === 'rev-list') return commandResult({ stdout: `${behind}\t${ahead}` });
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

function githubRunner({ behind = 0, ahead = 1 } = {}) {
  return (command, args) => {
    assert.equal(command, 'gh');
    if (args[0] === 'repo') return { nameWithOwner: 'example/repo' };
    if (args[0] === 'api') return { status: behind === 0 ? 'ahead' : 'diverged', behind_by: behind, ahead_by: ahead };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

test('base freshness records exact current ancestry evidence', () => {
  const result = inspectBaseFreshness('/repo', { worktreePath: '/repo/worktree' }, 'main', {
    runner: gitRunner({ ancestorExitCode: 0, behind: 0, ahead: 1 }),
    jsonRunner: () => { throw new Error('GitHub compare should not be required for a current local ancestry result.'); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'current');
  assert.equal(result.evidence.baseSha, 'base-sha');
  assert.equal(result.evidence.headSha, 'head-sha');
  assert.equal(result.evidence.mergeBase, 'base-sha');
  assert.equal(result.evidence.baseIsAncestor, true);
  assert.equal(result.evidence.ancestorExitCode, 0);
  assert.equal(result.evidence.behind, 0);
  assert.equal(result.evidence.ahead, 1);
});

test('git ancestry execution errors are indeterminate instead of stale', () => {
  const result = inspectBaseFreshness('/repo', { worktreePath: '/repo/worktree' }, 'main', {
    runner: gitRunner({ ancestorExitCode: 128, ancestorStderr: 'fatal: bad revision' }),
    jsonRunner: () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'indeterminate');
  assert.equal(result.evidence.ancestorExitCode, 128);
  assert.equal(result.evidence.ancestorError, 'fatal: bad revision');
  assert.match(result.reason, /coder was not asked to rewrite/i);
});

test('local stale result that contradicts GitHub becomes controller inconsistency', () => {
  const result = inspectBaseFreshness('/repo', { worktreePath: '/repo/worktree' }, 'main', {
    runner: gitRunner({ ancestorExitCode: 1, behind: 1, ahead: 1 }),
    jsonRunner: githubRunner({ behind: 0, ahead: 1 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'inconsistent');
  assert.equal(result.evidence.ancestorExitCode, 1);
  assert.equal(result.evidence.githubCompareAvailable, true);
  assert.equal(result.evidence.githubBehind, 0);
  assert.equal(result.evidence.githubAhead, 1);
  assert.match(result.reason, /GitHub reports it is 0 commits behind/);
});

test('genuine stale ancestry remains eligible for coder base update', () => {
  const result = inspectBaseFreshness('/repo', { worktreePath: '/repo/worktree' }, 'main', {
    runner: gitRunner({ ancestorExitCode: 1, behind: 2, ahead: 1 }),
    jsonRunner: githubRunner({ behind: 2, ahead: 1 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'stale');
  assert.equal(result.evidence.githubBehind, 2);
  assert.match(result.reason, /does not contain the latest main/);
});
