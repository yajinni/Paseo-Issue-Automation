import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_LABELS } from '../src/label-catalog.mjs';
import { loadRun, saveConfig, saveRun } from '../src/state.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function executable(file, content) {
  writeFileSync(file, content, { encoding: 'utf8', mode: 0o755 });
  chmodSync(file, 0o755);
}

function calls(file) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for recover-first controller to settle.');
}

test('restart worker safely reuses one failed attempt without creating a duplicate workspace', async (t) => {
  if (process.platform === 'win32') return t.skip('acceptance fixture uses Unix executable shims');

  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-recover-first-'));
  const root = path.join(fixture, 'repo');
  const bin = path.join(fixture, 'bin');
  const callsFile = path.join(fixture, 'calls.jsonl');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'config', 'user.name', 'Paseo Acceptance');
  git(root, 'config', 'user.email', 'acceptance@example.invalid');
  writeFileSync(path.join(root, 'README.md'), '# recover-first acceptance\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '--quiet', '-m', 'Initial fixture');
  const branch = 'ai/issue-303-recover-first-attempt-4';
  git(root, 'checkout', '--quiet', '-b', branch);

  executable(path.join(bin, 'paseo'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.PASEO_ACCEPTANCE_CALLS, JSON.stringify({ cmd: 'paseo', args }) + '\\n');
if (args[0] === 'ls') {
  process.stdout.write(JSON.stringify([{ id: 'coder-303', name: 'Issue #303 Coder (attempt 4)', cwd: process.env.PASEO_ACCEPTANCE_ROOT }]));
  process.exit(0);
}
if (args[0] === 'send') process.exit(0);
if (args[0] === 'wait') {
  process.stderr.write('simulated post-restart coder failure');
  process.exit(17);
}
process.stderr.write('Unexpected fake paseo command: ' + args.join(' '));
process.exit(2);
`);
  executable(path.join(bin, 'gh'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.PASEO_ACCEPTANCE_CALLS, JSON.stringify({ cmd: 'gh', args }) + '\\n');
if (args[0] === 'issue' && args[1] === 'edit') process.exit(0);
process.stderr.write('Unexpected fake gh command: ' + args.join(' '));
process.exit(2);
`);

  saveConfig(root, {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    maxActive: 1,
    codingHarness: 'fake',
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 0 },
    review: { workflow: 'full-immediate', quickMaxRounds: 2, fullMaxRounds: 2, autoMergeApproved: false },
    models: { orchestrator: 'fixture/coder', coder: 'fixture/coder', reviewer: 'fixture/reviewer' },
  });
  saveRun(root, 303, {
    issueNumber: 303,
    issueTitle: 'Recover failed attempt',
    attempt: 4,
    status: LEGACY_LABELS.failed,
    phase: 'queued',
    reason: 'Recover-first restart queued.',
    restartPending: true,
    restartPreviousPhase: 'failed',
    restartPreviousReason: 'Previous controller failed.',
    branch,
    worktreePath: root,
    workspaceId: 'workspace-303',
    workspaceTitle: branch,
    workspaceName: branch,
    coderAgentId: 'coder-303',
    agentId: 'coder-303',
    agentTitle: 'Issue #303 Coder (attempt 4)',
    events: [],
    activity: [],
  });

  const worker = fileURLToPath(new URL('../src/manager-restart-worker.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [worker, root, '303', 'keep'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      PASEO_ACCEPTANCE_CALLS: callsFile,
      PASEO_ACCEPTANCE_ROOT: root,
      PASEO_COMMAND_TIMEOUT_MS: '10000',
      PASEO_AGENT_TIMEOUT_MS: '10000',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const settled = await waitFor(() => {
    const state = loadRun(root, 303);
    return state?.phase === 'failed' && state?.completedAt ? state : null;
  });

  assert.equal(settled.attempt, 4);
  assert.equal(settled.branch, branch);
  assert.equal(settled.workspaceId, 'workspace-303');
  assert.equal(settled.coderAgentId, 'coder-303');
  assert.equal(settled.failedAttemptRecoveryCount, 1);
  assert.equal(settled.restartPending, false);
  assert.match(settled.reason || '', /simulated post-restart coder failure/i);
  assert.ok((settled.activity || []).some((entry) => entry.type === 'failed-attempt-recovery-started'));
  assert.ok((settled.activity || []).some((entry) => entry.type === 'controller-restarted-for-recovery'));

  const log = calls(callsFile);
  assert.equal(log.filter((call) => call.cmd === 'paseo' && call.args[0] === 'send').length, 1);
  assert.equal(log.filter((call) => call.cmd === 'paseo' && call.args[0] === 'wait').length, 1);
  assert.equal(log.filter((call) => call.cmd === 'paseo' && call.args[0] === 'workspace' && call.args[1] === 'create').length, 0);
  assert.equal(log.filter((call) => call.cmd === 'paseo' && call.args[0] === 'workspace' && call.args[1] === 'archive').length, 0);
});
