import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchSpecificIssue } from '../src/attempts.mjs';
import { loadIssueLifecycle, loadRun, saveConfig, saveRuntime } from '../src/state.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeExecutable(file, content) {
  writeFileSync(file, content, { encoding: 'utf8', mode: 0o755 });
  chmodSync(file, 0o755);
}

function issueBody() {
  return [
    '<!-- paseo-issue-template:v2 -->',
    '## Objective',
    'Recover an incomplete coder completion handoff.',
    '## Required behavior',
    'Keep the same attempt and coder when the first completion lacks a pushed exact head.',
    '## Acceptance criteria',
    '- One recovery prompt repairs the handoff and the resulting PR reaches human review.',
    '## Validation and checks',
    '- The recovered worktree is clean, committed, pushed, and exact-head reviewed.',
    '## Stop conditions',
    '- Stop if recovery would require a second coder or a fresh attempt.',
  ].join('\n\n');
}

function setupRepository(t, { recoverCompletion = true } = {}) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-completion-recovery-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# completion recovery fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  if (recoverCompletion) writeFileSync(path.join(fixture, 'allow-recovery'), 'yes\n');

  const issue = {
    number: 103,
    title: 'Recover incomplete completion handoff',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/103',
    createdAt: new Date(0).toISOString(),
    blockedBy: { nodes: [], totalCount: 0 },
    blocking: { nodes: [], totalCount: 0 },
    closedByPullRequestsReferences: [],
    comments: [],
  };
  writeFileSync(path.join(fixture, 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);

  const ghScript = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fixture = process.env.PASEO_ACCEPTANCE_FIXTURE;
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'gh', args, cwd: process.cwd() }) + '\\n');
const issue = JSON.parse(readFileSync(path.join(fixture, 'issue.json'), 'utf8'));
const prFile = path.join(fixture, 'pr.json');
const output = (value) => process.stdout.write(JSON.stringify(value));
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
if (args[0] === 'repo' && args[1] === 'view') { output({ nameWithOwner: 'owner/repo' }); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'view') { output(issue); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') { output([]); process.exit(0); }
if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'comment')) process.exit(0);
if (args[0] === 'pr' && args[1] === 'list') { output(existsSync(prFile) ? [JSON.parse(readFileSync(prFile, 'utf8'))] : []); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') {
  const headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  const baseRefName = arg('--base') || 'main';
  const baseRefOid = execFileSync('git', ['rev-parse', 'origin/' + baseRefName], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  const pr = { number: 9, url: 'https://example.invalid/owner/repo/pull/9', isDraft: true, headRefOid, baseRefName, baseRefOid, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
  writeFileSync(prFile, JSON.stringify(pr, null, 2));
  process.stdout.write(pr.url);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'view') { if (!existsSync(prFile)) process.exit(1); output(JSON.parse(readFileSync(prFile, 'utf8'))); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'comment') process.exit(0);
if (args[0] === 'api') { output({ status: 'ahead', behind_by: 0, ahead_by: 1 }); process.exit(0); }
process.stderr.write('Unhandled fake gh command: ' + args.join(' '));
process.exit(2);
`;

  const paseoScript = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fixture = process.env.PASEO_ACCEPTANCE_FIXTURE;
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'paseo', args, cwd: process.cwd() }) + '\\n');
const output = (value) => process.stdout.write(JSON.stringify(value));
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const workspaceFile = path.join(fixture, 'workspace.json');
if (args[0] === 'workspace' && args[1] === 'create') {
  const root = arg('--path');
  const branch = arg('--new-branch');
  const base = arg('--base');
  const title = arg('--title');
  const worktree = path.join(fixture, 'worktree');
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', branch, worktree, 'origin/' + base], { cwd: root, stdio: 'pipe' });
  const workspace = { workspaceId: 'workspace-1', cwd: worktree, title, branch };
  writeFileSync(workspaceFile, JSON.stringify(workspace, null, 2));
  output(workspace);
  process.exit(0);
}
if (args[0] === 'run' && args.includes('--background')) { output({ agentId: 'agent-1' }); process.exit(0); }
if (args[0] === 'wait') {
  const firstWait = path.join(fixture, 'first-wait-completed');
  const recoveryPending = path.join(fixture, 'recovery-pending');
  if (!existsSync(firstWait)) {
    writeFileSync(firstWait, 'done without pushed completion evidence\\n');
    process.exit(0);
  }
  if (existsSync(recoveryPending) && existsSync(path.join(fixture, 'allow-recovery'))) {
    const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'completion recovery succeeded\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Repair completion handoff'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', '-u', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    unlinkSync(recoveryPending);
  }
  process.exit(0);
}
if (args[0] === 'send') { writeFileSync(path.join(fixture, 'recovery-pending'), 'recover\\n'); process.exit(0); }
if (args[0] === 'run') { output({ approved: true, findings: 'Recovered exact-head handoff approved.' }); process.exit(0); }
if (args[0] === 'stop') process.exit(0);
if (args[0] === 'ls') { output([]); process.exit(0); }
if (args[0] === 'workspace' && args[1] === 'archive') process.exit(0);
process.stderr.write('Unhandled fake paseo command: ' + args.join(' '));
process.exit(2);
`;

  writeExecutable(path.join(bin, 'gh'), ghScript);
  writeExecutable(path.join(bin, 'paseo'), paseoScript);

  const previous = {
    PATH: process.env.PATH,
    fixture: process.env.PASEO_ACCEPTANCE_FIXTURE,
    commandTimeout: process.env.PASEO_COMMAND_TIMEOUT_MS,
    agentTimeout: process.env.PASEO_AGENT_TIMEOUT_MS,
  };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
  process.env.PASEO_ACCEPTANCE_FIXTURE = fixture;
  process.env.PASEO_COMMAND_TIMEOUT_MS = '10000';
  process.env.PASEO_AGENT_TIMEOUT_MS = '10000';

  saveConfig(root, {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 60,
    maxActive: 1,
    codingHarness: 'fake',
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 0 },
    review: { workflow: 'full-immediate', quickMaxRounds: 2, fullMaxRounds: 2, autoMergeApproved: false },
    models: {
      orchestrator: 'fixture/coder',
      coder: 'fixture/coder',
      coderThinking: 'medium',
      reviewer: 'fixture/reviewer',
      reviewerThinking: 'high',
    },
  });
  saveRuntime(root, { claimsEnabled: true, skippedIssueNumbers: [] });

  t.after(() => {
    const state = loadRun(root, 103);
    if (state?.controllerPid) {
      try { process.kill(state.controllerPid, 0); process.kill(state.controllerPid, 'SIGTERM'); } catch {}
    }
    process.env.PATH = previous.PATH;
    if (previous.fixture === undefined) delete process.env.PASEO_ACCEPTANCE_FIXTURE;
    else process.env.PASEO_ACCEPTANCE_FIXTURE = previous.fixture;
    if (previous.commandTimeout === undefined) delete process.env.PASEO_COMMAND_TIMEOUT_MS;
    else process.env.PASEO_COMMAND_TIMEOUT_MS = previous.commandTimeout;
    if (previous.agentTimeout === undefined) delete process.env.PASEO_AGENT_TIMEOUT_MS;
    else process.env.PASEO_AGENT_TIMEOUT_MS = previous.agentTimeout;
    rmSync(fixture, { recursive: true, force: true });
  });

  return { fixture, root };
}

async function waitForTerminalRun(root, issueNumber, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = loadRun(root, issueNumber);
    if (state?.phase === 'human-review' || state?.phase === 'failed') return state;
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for issue #${issueNumber}; latest phase was ${state?.phase || 'missing'}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function commandLog(fixture) {
  const file = path.join(fixture, 'commands.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function countCommands(commands, command, predicate) {
  return commands.filter((entry) => entry.command === command && predicate(entry.args)).length;
}

test('functional acceptance: incomplete coder completion evidence recovers once on the same attempt and reaches human review', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);

  const dispatch = dispatchSpecificIssue(root, 103);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.issueNumber, 103);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 103);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 103, { limit: 120 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }

  assert.equal(state.status, 'human-review');
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 9);
  assert.equal(state.attempt, 1);
  assert.equal(state.workspaceId, 'workspace-1');
  assert.equal(state.coderAgentId, 'agent-1');

  const recoveryActivities = (state.activity || []).filter((entry) => entry.type === 'completion-evidence-recovery');
  assert.equal(recoveryActivities.length, 1);
  assert.match(recoveryActivities[0].details, /recovery attempt 1\/1/i);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(state.approvedCommit, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'completion recovery succeeded\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const validation = (state.events || []).find((event) => event.event === 'validation-summary' && event.result === 'PASS');
  const review = (state.events || []).find((event) => event.event === 'review' && event.result === 'APPROVED');
  assert.equal(validation?.commit, finalHead);
  assert.equal(review?.commit, finalHead);

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'workspace' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 1);
});

test('functional acceptance: persistent incomplete completion evidence fails closed after the single recovery attempt', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t, { recoverCompletion: false });

  const dispatch = dispatchSpecificIssue(root, 103);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 103);
  assert.equal(state.phase, 'failed');
  assert.notEqual(state.status, 'human-review');
  assert.equal(state.attempt, 1);
  assert.equal(state.workspaceId, 'workspace-1');
  assert.equal(state.coderAgentId, 'agent-1');
  assert.equal(state.prNumber, null);
  assert.match(state.reason || '', /pushed|branch|completion/i);

  const recoveryActivities = (state.activity || []).filter((entry) => entry.type === 'completion-evidence-recovery');
  assert.equal(recoveryActivities.length, 1);
  assert.match(recoveryActivities[0].details, /recovery attempt 1\/1/i);
  assert.equal((state.events || []).some((event) => event.event === 'validation-summary' && event.result === 'PASS'), false);
  assert.equal((state.events || []).some((event) => event.event === 'review'), false);

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'workspace' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 0);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 0);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 0);

  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]);
  assert.equal(remoteHead, '');
  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');
});
