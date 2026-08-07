import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  issueLifecycleFile,
  loadIssueLifecycle,
  removeRun,
  saveRun,
} from '../src/state.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pia-lifecycle-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Lifecycle Test');
  writeFileSync(path.join(root, 'README.md'), 'test\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'initial');
  git(root, 'branch', '-M', 'main');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

test('run state writes an append-only per-issue lifecycle across run removal', () => {
  const root = repository();
  try {
    saveRun(root, 274, {
      issueNumber: 274,
      attempt: 4,
      status: 'agent-running',
      phase: 'coding',
      branch: 'ai/issue-274-attempt-4',
      worktreePath: root,
      activity: [],
      events: [],
    });
    saveRun(root, 274, {
      issueNumber: 274,
      attempt: 4,
      status: 'agent-running',
      phase: 'updating-from-base',
      branch: 'ai/issue-274-attempt-4',
      worktreePath: root,
      activity: [{
        type: 'base-update-required',
        at: '2026-08-07T23:30:00.000Z',
        details: 'The issue branch does not contain the latest main.',
      }],
      events: [],
    });

    const lifecycle = loadIssueLifecycle(root, 274);
    assert.ok(lifecycle.length >= 3);
    const freshness = lifecycle.find((event) => event.type === 'base-update-required');
    assert.ok(freshness);
    assert.equal(freshness.attempt, 4);
    assert.equal(freshness.evidence.baseBranch, 'main');
    assert.equal(freshness.evidence.baseIsAncestor, true);
    assert.equal(freshness.evidence.behind, 0);
    assert.equal(freshness.evidence.ahead, 0);
    assert.match(freshness.evidence.baseSha, /^[0-9a-f]{40}$/);
    assert.equal(freshness.evidence.baseSha, freshness.evidence.headSha);
    assert.equal(freshness.evidence.mergeBase, freshness.evidence.headSha);

    const file = issueLifecycleFile(root, 274);
    removeRun(root, 274);
    assert.ok(loadIssueLifecycle(root, 274).length >= lifecycle.length);
    assert.match(file, /lifecycle[\\/]issue-274\.jsonl$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lifecycle logging redacts obvious inline secrets from activity text', () => {
  const root = repository();
  try {
    saveRun(root, 9, {
      issueNumber: 9,
      attempt: 1,
      status: 'agent-running',
      phase: 'coding',
      activity: [{ type: 'diagnostic', details: 'token=super-secret password=hunter2 safe=value' }],
      events: [],
    });
    const diagnostic = loadIssueLifecycle(root, 9).find((event) => event.type === 'diagnostic');
    assert.ok(diagnostic);
    assert.doesNotMatch(diagnostic.message, /super-secret|hunter2/);
    assert.match(diagnostic.message, /token=\[REDACTED\]/i);
    assert.match(diagnostic.message, /password=\[REDACTED\]/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
