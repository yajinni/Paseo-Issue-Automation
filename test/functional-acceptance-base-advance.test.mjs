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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalDetachedController(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function stopDetachedController(pid, timeoutMs = 3000) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (!signalDetachedController(pid, 'SIGTERM')) return;

  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!processIsAlive(pid)) return;

  signalDetachedController(pid, 'SIGKILL');
  const killDeadline = Date.now() + 1000;
  while (processIsAlive(pid) && Date.now() < killDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function issueBody() {
  return [
    '<!-- paseo-issue-template:v2 -->',
    '## Objective',
    'Update a reviewed issue branch when main advances.',
    '## Required behavior',
    'Merge the newly advanced base into the same issue branch and PR.',
    '## Acceptance criteria',
    '- Approval from the stale head is never reused after the base update.',
    '## Validation and checks',
    '- The updated exact head contains both issue work and the new base commit.',
    '## Stop conditions',
    '- Stop if base freshness cannot be proven or the same PR cannot be preserved.',
  ].join('\n\n');
}

function setupRepository(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-base-advance-acceptance-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  const controllerPids = new Set();
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# base advance acceptance fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  writeFileSync(path.join(fixture, 'root-path'), root);

  const issue = {
    number: 105,
    title: 'Revalidate after base advances',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/105',
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
const root = readFileSync(path.join(fixture, 'root-path'), 'utf8').trim();
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'gh', args, cwd: process.cwd() }) + '\\n');
const issue = JSON.parse(readFileSync(path.join(fixture, 'issue.json'), 'utf8'));
const prFile = path.join(fixture, 'pr.json');
const output = (value) => process.stdout.write(JSON.stringify(value));
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
function currentPr() {
  if (!existsSync(prFile)) return null;
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  pr.baseRefOid = execFileSync('git', ['rev-parse', 'main'], { cwd: root, encoding: 'utf8' }).trim();
  pr.statusCheckRollup = [];
  return pr;
}
if (args[0] === 'repo' && args[1] === 'view') { output({ nameWithOwner: 'owner/repo' }); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'view') { output(issue); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') { output([]); process.exit(0); }
if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'comment')) process.exit(0);
if (args[0] === 'pr' && args[1] === 'list') { const pr = currentPr(); output(pr ? [pr] : []); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') {
  const headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  const baseRefName = arg('--base') || 'main';
  const baseRefOid = execFileSync('git', ['rev-parse', 'main'], { cwd: root, encoding: 'utf8' }).trim();
  const pr = { number: 11, url: 'https://example.invalid/owner/repo/pull/11', isDraft: true, headRefOid, baseRefName, baseRefOid, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
  writeFileSync(prFile, JSON.stringify(pr, null, 2));
  process.stdout.write(pr.url);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'view') { const pr = currentPr(); if (!pr) process.exit(1); output(pr); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'comment') process.exit(0);
if (args[0] === 'api') {
  const pr = currentPr();
  if (!pr) process.exit(1);
  const behindBy = Number(execFileSync('git', ['rev-list', '--count', pr.headRefOid + '..' + pr.baseRefOid], { cwd: root, encoding: 'utf8' }).trim());
  const aheadBy = Number(execFileSync('git', ['rev-list', '--count', pr.baseRefOid + '..' + pr.headRefOid], { cwd: root, encoding: 'utf8' }).trim());
  const status = behindBy > 0 ? (aheadBy > 0 ? 'diverged' : 'behind') : (aheadBy > 0 ? 'ahead' : 'identical');
  output({ status, behind_by: behindBy, ahead_by: aheadBy });
  process.exit(0);
}
process.stderr.write('Unhandled fake gh command: ' + args.join(' '));
process.exit(2);
`;

  const paseoScript = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fixture = process.env.PASEO_ACCEPTANCE_FIXTURE;
const root = readFileSync(path.join(fixture, 'root-path'), 'utf8').trim();
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'paseo', args, cwd: process.cwd() }) + '\\n');
const output = (value) => process.stdout.write(JSON.stringify(value));
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const workspaceFile = path.join(fixture, 'workspace.json');
const prFile = path.join(fixture, 'pr.json');
if (args[0] === 'workspace' && args[1] === 'create') {
  const repositoryRoot = arg('--path');
  const branch = arg('--new-branch');
  const base = arg('--base');
  const title = arg('--title');
  const worktree = path.join(fixture, 'worktree');
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', branch, worktree, 'origin/' + base], { cwd: repositoryRoot, stdio: 'pipe' });
  const workspace = { workspaceId: 'workspace-1', cwd: worktree, title, branch };
  writeFileSync(workspaceFile, JSON.stringify(workspace, null, 2));
  output(workspace);
  process.exit(0);
}
if (args[0] === 'run' && args.includes('--background')) { output({ agentId: 'agent-1' }); process.exit(0); }
if (args[0] === 'wait') {
  const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
  const completed = path.join(fixture, 'coder-completed');
  const baseUpdatePending = path.join(fixture, 'base-update-pending');
  if (!existsSync(completed)) {
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'initial approved head\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Add initial issue work'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', '-u', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    writeFileSync(completed, 'done\\n');
  } else if (existsSync(baseUpdatePending)) {
    if (!existsSync(path.join(fixture, 'withhold-base-update'))) {
      execFileSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: workspace.cwd, stdio: 'pipe' });
      execFileSync('git', ['push', '--quiet', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
      const pr = JSON.parse(readFileSync(prFile, 'utf8'));
      pr.headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.cwd, encoding: 'utf8' }).trim();
      writeFileSync(prFile, JSON.stringify(pr, null, 2));
    }
    unlinkSync(baseUpdatePending);
  }
  process.exit(0);
}
if (args[0] === 'send') { writeFileSync(path.join(fixture, 'base-update-pending'), 'update base\\n'); process.exit(0); }
if (args[0] === 'run') {
  const countFile = path.join(fixture, 'review-count');
  const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0;
  writeFileSync(countFile, String(count + 1));
  if (count === 0) {
    writeFileSync(path.join(root, 'base-update.txt'), 'new base work\\n');
    execFileSync('git', ['add', 'base-update.txt'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Advance main during review'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: root, stdio: 'pipe' });
  }
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  output({
    repository: 'owner/repo',
    pullRequestNumber: 11,
    issueNumber: 105,
    headSha: pr.headRefOid,
    stage: 'full',
    round: count + 1,
    promptVersion: 1,
    result: 'pass',
    summary: 'Independent staged reviewer approved this exact head.',
    findings: [],
  });
  process.exit(0);
}
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
    review: { workflow: 'full-immediate', quickMaxRounds: 2, fullMaxRounds: 3, autoMergeApproved: false },
    models: {
      orchestrator: 'fixture/coder',
      coder: 'fixture/coder',
      coderThinking: 'medium',
      reviewer: 'fixture/reviewer',
      reviewerThinking: 'high',
    },
  });
  saveRuntime(root, { claimsEnabled: true, skippedIssueNumbers: [] });

  t.after(async () => {
    for (const controllerPid of controllerPids) {
      await stopDetachedController(controllerPid);
    }
    process.env.PATH = previous.PATH;
    if (previous.fixture === undefined) delete process.env.PASEO_ACCEPTANCE_FIXTURE;
    else process.env.PASEO_ACCEPTANCE_FIXTURE = previous.fixture;
    if (previous.commandTimeout === undefined) delete process.env.PASEO_COMMAND_TIMEOUT_MS;
    else process.env.PASEO_COMMAND_TIMEOUT_MS = previous.commandTimeout;
    if (previous.agentTimeout === undefined) delete process.env.PASEO_AGENT_TIMEOUT_MS;
    else process.env.PASEO_AGENT_TIMEOUT_MS = previous.agentTimeout;
    rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  return { fixture, root, controllerPids };
}

async function waitForTerminalRun(root, issueNumber, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = loadRun(root, issueNumber);
    if (state?.phase === 'human-review' || state?.phase === 'failed') return state;
    if (Date.now() >= deadline) assert.fail(`Timed out waiting for issue #${issueNumber}; latest phase was ${state?.phase || 'missing'}.`);
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

test('functional acceptance: a base advance after approval forces a same-PR base merge and fresh exact-head review', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root, controllerPids } = setupRepository(t);

  const dispatch = dispatchSpecificIssue(root, 105);
  controllerPids.add(dispatch.controllerPid);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 105);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 105, { limit: 180 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 11);
  assert.equal(state.attempt, 1);
  assert.equal(state.workspaceId, 'workspace-1');
  assert.equal(state.coderAgentId, 'agent-1');

  const reviews = (state.events || []).filter((event) => event.event === 'review');
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].result, 'APPROVED');
  assert.equal(reviews[1].result, 'APPROVED');
  assert.notEqual(reviews[0].commit, reviews[1].commit);
  assert.equal(state.approvedCommit, reviews[1].commit);

  const validatedCommits = new Set((state.events || [])
    .filter((event) => event.event === 'validation-summary' && event.result === 'PASS')
    .map((event) => event.commit));
  assert.equal(validatedCommits.has(reviews[0].commit), true);
  assert.equal(validatedCommits.has(reviews[1].commit), true);

  const lifecycle = loadIssueLifecycle(root, 105, { limit: 180 });
  const freshness = lifecycle.filter((entry) => entry.type === 'base-freshness-check');
  assert.equal(freshness.some((entry) => entry.status === 'warning'), true);
  assert.equal(freshness.some((entry) => entry.status === 'success'), true);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const newBase = git(root, ['rev-parse', 'main']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(git(worktree, ['merge-base', newBase, finalHead]), newBase);
  assert.equal(finalHead, reviews[1].commit);
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.number, 11);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'initial approved head\n');
  assert.equal(readFileSync(path.join(worktree, 'base-update.txt'), 'utf8'), 'new base work\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 2);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 2);
});

test('functional acceptance: repeated no-op base updates stay bounded and fail closed without reusing stale approval', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root, controllerPids } = setupRepository(t);
  writeFileSync(path.join(fixture, 'withhold-base-update'), 'withhold\n');

  const dispatch = dispatchSpecificIssue(root, 105);
  controllerPids.add(dispatch.controllerPid);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 105);
  assert.equal(state.phase, 'failed');
  assert.equal(state.reason, 'Maximum controller repair cycles reached.');
  assert.equal(state.prNumber, 11);
  assert.equal(state.attempt, 1);
  assert.equal(state.workspaceId, 'workspace-1');
  assert.equal(state.coderAgentId, 'agent-1');

  const reviews = (state.events || []).filter((event) => event.event === 'review');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].result, 'APPROVED');
  const validated = (state.events || []).filter((event) => event.event === 'validation-summary' && event.result === 'PASS');
  assert.equal(validated.length, 1);
  assert.equal(validated[0].commit, reviews[0].commit);

  const lifecycle = loadIssueLifecycle(root, 105, { limit: 180 });
  const freshness = lifecycle.filter((entry) => entry.type === 'base-freshness-check');
  assert.equal(freshness.filter((entry) => entry.status === 'warning').length, 8);
  assert.equal(freshness.at(-1)?.status, 'warning');

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const newBase = git(root, ['rev-parse', 'main']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  assert.equal(finalHead, reviews[0].commit);
  assert.equal(remoteHead, finalHead);
  assert.notEqual(git(worktree, ['merge-base', newBase, finalHead]), newBase);
  assert.equal(existsSync(path.join(worktree, 'base-update.txt')), false);
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 8);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 9);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 1);
});
