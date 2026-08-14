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
    'Repair a reviewed pull request after GitHub CI fails.',
    '## Required behavior',
    'Keep the same issue attempt and PR while repairing the failed reviewed head.',
    '## Acceptance criteria',
    '- The repaired exact head is freshly validated and independently reviewed before human review.',
    '## Validation and checks',
    '- Head A fails GitHub CI; head B passes.',
    '## Stop conditions',
    '- Stop if Paseo would reuse head-A approval for head B.',
  ].join('\n\n');
}

function setupRepository(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-ci-repair-acceptance-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# ci repair acceptance fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);

  const issue = {
    number: 104,
    title: 'Repair failed CI on reviewed head',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/104',
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
function currentPr() {
  if (!existsSync(prFile)) return null;
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  pr.statusCheckRollup = existsSync(path.join(fixture, 'ci-repaired'))
    ? []
    : [{ name: 'acceptance-ci', conclusion: 'FAILURE', status: 'COMPLETED' }];
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
  const baseRefOid = execFileSync('git', ['rev-parse', 'origin/' + baseRefName], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  const pr = { number: 10, url: 'https://example.invalid/owner/repo/pull/10', isDraft: true, headRefOid, baseRefName, baseRefOid, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
  writeFileSync(prFile, JSON.stringify(pr, null, 2));
  process.stdout.write(pr.url);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'view') { const pr = currentPr(); if (!pr) process.exit(1); output(pr); process.exit(0); }
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
const workspaceBase = (value) => {
  const base = String(value || '');
  return /^[0-9a-f]{40}$/i.test(base) || base.startsWith('origin/') || base.startsWith('refs/')
    ? base
    : 'origin/' + base;
};
const workspaceFile = path.join(fixture, 'workspace.json');
const prFile = path.join(fixture, 'pr.json');
if (args[0] === 'workspace' && args[1] === 'create') {
  const root = arg('--path');
  const branch = arg('--new-branch');
  const base = arg('--base');
  const title = arg('--title');
  const worktree = path.join(fixture, 'worktree');
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', branch, worktree, workspaceBase(base)], { cwd: root, stdio: 'pipe' });
  const workspace = { workspaceId: 'workspace-1', cwd: worktree, title, branch };
  writeFileSync(workspaceFile, JSON.stringify(workspace, null, 2));
  output(workspace);
  process.exit(0);
}
if (args[0] === 'run' && args.includes('--background')) { output({ agentId: 'agent-1' }); process.exit(0); }
if (args[0] === 'wait') {
  const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
  const completed = path.join(fixture, 'coder-completed');
  const repairPending = path.join(fixture, 'ci-repair-pending');
  if (!existsSync(completed)) {
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'initial reviewed head with failing ci\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Add initial CI marker'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', '-u', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    writeFileSync(completed, 'done\\n');
  } else if (existsSync(repairPending)) {
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'ci repair completed\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Repair failed CI'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    const pr = JSON.parse(readFileSync(prFile, 'utf8'));
    pr.headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.cwd, encoding: 'utf8' }).trim();
    writeFileSync(prFile, JSON.stringify(pr, null, 2));
    writeFileSync(path.join(fixture, 'ci-repaired'), 'passed\\n');
    unlinkSync(repairPending);
  }
  process.exit(0);
}
if (args[0] === 'send') { writeFileSync(path.join(fixture, 'ci-repair-pending'), 'repair\\n'); process.exit(0); }
if (args[0] === 'run') {
  const countFile = path.join(fixture, 'review-count');
  const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0;
  writeFileSync(countFile, String(count + 1));
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  output({
    repository: 'owner/repo',
    pullRequestNumber: 10,
    issueNumber: 104,
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

  t.after(() => {
    const state = loadRun(root, 104);
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

test('functional acceptance: failed CI repairs the same PR and requires fresh validation and review on the new head', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);

  const dispatch = dispatchSpecificIssue(root, 104);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 104);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 104, { limit: 160 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 10);
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

  const ciFailures = (state.activity || []).filter((entry) => entry.type === 'ci-failed');
  assert.equal(ciFailures.length, 1);
  assert.match(ciFailures[0].details, /acceptance-ci: FAILURE/);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(finalHead, reviews[1].commit);
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.number, 10);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'ci repair completed\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 2);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 2);
});
