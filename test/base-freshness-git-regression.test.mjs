import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectBaseFreshness } from '../src/base-freshness.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('base freshness preserves the fetched origin base ref in a linked worktree when pruning', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-base-freshness-'));
  const remote = path.join(fixture, 'remote.git');
  const root = path.join(fixture, 'repo');
  const worktree = path.join(fixture, 'worktree');
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Base Freshness']);
  git(root, ['config', 'user.email', 'base-freshness@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# base freshness fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  git(root, ['worktree', 'add', '--quiet', '-b', 'issue', worktree, 'origin/main']);

  writeFileSync(path.join(worktree, 'issue.txt'), 'issue change\n');
  git(worktree, ['add', 'issue.txt']);
  git(worktree, ['commit', '--quiet', '-m', 'Issue change']);

  const result = inspectBaseFreshness(root, { worktreePath: worktree }, 'main', {
    jsonRunner: () => {
      throw new Error('GitHub compare should not be required when the local branch contains the current base.');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'current');
  assert.equal(result.evidence.fetchExitCode, 0);
  assert.equal(result.evidence.baseResolveExitCode, 0);
  assert.equal(result.evidence.ancestorExitCode, 0);
  assert.equal(
    git(worktree, ['rev-parse', 'refs/remotes/origin/main']),
    result.evidence.baseSha,
  );
});
