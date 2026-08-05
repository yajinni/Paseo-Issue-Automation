import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createSetupPullRequest,
  loadSetupPullRequest,
  parsePorcelainStatus,
  preflightSetupPullRequest,
  reconcileSetupPullRequest,
  saveSetupPullRequest,
  setupChangeStatus,
  setupPullRequestBlocksSetup,
} from '../src/setup-pr.mjs';
import { saveConfig } from '../src/state.mjs';

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-setup-pr-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Paseo Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'paseo@example.test'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: root, stdio: 'ignore' });
  saveConfig(root, {
    setupComplete: false,
    baseBranch: 'main',
    pollIntervalSeconds: 120,
    maxActive: 1,
    maxReviewRounds: 4,
    models: {},
    workspace: {},
  });
  return root;
}

function ok(stdout = '') {
  return { ok: true, exitCode: 0, stdout, stderr: '' };
}

function failed(stderr = '') {
  return { ok: false, exitCode: 1, stdout: '', stderr };
}

test('porcelain parser and setup status separate expected files from unrelated work', () => {
  assert.deepEqual(parsePorcelainStatus(' M package.json\n?? paseo.json\n?? src/private-work.mjs'), [
    { status: ' M', path: 'package.json' },
    { status: '??', path: 'paseo.json' },
    { status: '??', path: 'src/private-work.mjs' },
  ]);
  const runner = (_command, args) => {
    if (args[0] === 'status') return ok(' M package.json\n?? paseo.json\n?? src/private-work.mjs');
    if (args[0] === 'branch') return ok('main');
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
  const status = setupChangeStatus('/repo', { runner });
  assert.deepEqual(status.expectedFiles, ['package.json', 'paseo.json']);
  assert.deepEqual(status.unexpectedFiles, ['src/private-work.mjs']);
});

test('preflight refuses to mix setup files with unrelated working-tree changes', () => {
  const root = temporaryRepository();
  try {
    writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"paseo-issue-automation":"latest"}}\n');
    writeFileSync(path.join(root, 'notes.txt'), 'unrelated\n');
    assert.throws(
      () => preflightSetupPullRequest(root),
      /unrelated working-tree changes.*notes\.txt/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('automatic setup PR stages only allowlisted files and returns to the base branch', () => {
  const root = temporaryRepository();
  const calls = [];
  let branch = 'main';
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git' && args[0] === 'status') return ok(' M package.json\n?? paseo.json');
    if (command === 'git' && args[0] === 'branch' && args[1] === '--show-current') return ok(branch);
    if (command === 'git' && args[0] === 'config') return ok(args.at(-1) === 'user.name' ? 'Paseo Test' : 'paseo@example.test');
    if (command === 'git' && ['show-ref', 'ls-remote'].includes(args[0])) return failed();
    if (command === 'git' && args[0] === 'switch' && args[1] === '-c') {
      branch = args[2];
      return ok();
    }
    if (command === 'git' && args[0] === 'switch') {
      branch = args[1];
      return ok();
    }
    if (command === 'git' && args[0] === 'diff') return ok('package.json\npaseo.json');
    if (command === 'git' && args[0] === 'rev-parse') return ok('abc123');
    if (command === 'git') return ok();
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') return ok('https://github.test/pr/7');
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  const jsonRunner = () => ({
    number: 7,
    url: 'https://github.test/pr/7',
    state: 'OPEN',
    mergedAt: null,
    headRefName: 'ai/install-paseo-automation',
    headRefOid: 'abc123',
    baseRefName: 'main',
  });
  try {
    const result = createSetupPullRequest(root, { runner, jsonRunner, now: new Date('2026-08-05T00:00:00Z') });
    assert.equal(result.created, true);
    assert.equal(result.returnedToBaseBranch, true);
    assert.equal(branch, 'main');
    const add = calls.find((call) => call[0] === 'git' && call[1] === 'add');
    assert.deepEqual(add.slice(3).sort(), ['package.json', 'paseo.json']);
    const saved = loadSetupPullRequest(root);
    assert.equal(saved.number, 7);
    assert.equal(saved.state, 'open');
    assert.deepEqual(saved.files, ['package.json', 'paseo.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('merged setup PR fast-forwards the clean base branch and becomes ready', () => {
  const root = temporaryRepository();
  try {
    saveSetupPullRequest(root, {
      number: 7,
      url: 'https://github.test/pr/7',
      branch: 'ai/install-paseo-automation',
      baseBranch: 'main',
      state: 'open',
      syncedAt: null,
    });
    const runner = (_command, args) => {
      if (args[0] === 'status') return ok('');
      if (args[0] === 'branch') return ok('main');
      if (args[0] === 'pull') return ok('Fast-forward');
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };
    const jsonRunner = () => ({
      number: 7,
      url: 'https://github.test/pr/7',
      state: 'MERGED',
      mergedAt: '2026-08-05T00:00:00Z',
      headRefName: 'ai/install-paseo-automation',
      headRefOid: 'abc123',
      baseRefName: 'main',
    });
    const result = reconcileSetupPullRequest(root, { runner, jsonRunner });
    assert.equal(result.state, 'merged');
    assert.ok(result.syncedAt);
    assert.equal(setupPullRequestBlocksSetup(result), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('open and unsynchronized setup PRs block setup completion', () => {
  assert.equal(setupPullRequestBlocksSetup(null), false);
  assert.equal(setupPullRequestBlocksSetup({ state: 'open', syncedAt: null }), true);
  assert.equal(setupPullRequestBlocksSetup({ state: 'merged', syncedAt: null }), true);
  assert.equal(setupPullRequestBlocksSetup({ state: 'merged', syncedAt: '2026-08-05T00:00:00Z' }), false);
});
