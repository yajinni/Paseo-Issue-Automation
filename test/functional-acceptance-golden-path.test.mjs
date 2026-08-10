import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
    'Create the deterministic acceptance marker.',
    '## Required behavior',
    'Add one committed marker file and push the issue branch.',
    '## Acceptance criteria',
    '- The marker exists on the PR head.',
    '## Validation and checks',
    '- The working tree is clean and the branch is pushed.',
    '## Stop conditions',
    '- Stop if the fixture cannot create or push the branch.',
  ].join('\n\n');
}

function setupRepository(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-functional-acceptance-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# acceptance fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+main:refs/remotes/origin/main']);

  const issue = {
    number: 101,
    title: 'Create acceptance marker',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/101',
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
  const pr = { number: 7, url: 'https://example.invalid/owner/repo/pull/7', isDraft: true, headRefOid, baseRefName, baseRefOid, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
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
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
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
  const completed = path.join(fixture, 'coder-completed');
  if (!existsSync(completed)) {
    const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'golden path completed\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Add acceptance marker'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', '-u', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    writeFileSync(completed, 'done\\n');
  }
  process.exit(0);
}
if (args[0] === 'run') {
  const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.cwd, encoding: 'utf8' }).trim();
  output({
    repository: 'owner/repo',
    pullRequestNumber: 7,
    issueNumber: 101,
    headSha,
    stage: 'full',
    round: 1,
    promptVersion: 1,
    result: 'pass',
    summary: 'Golden-path fixture approved the exact staged Heavy review.',
    findings: [],
  });
  process.exit(0);
}
if (args[0] === 'send' || args[0] === 'stop') process.exit(0);
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
    const state = loadRun(root, 101);
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

function commandOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

test('functional acceptance: one eligible issue reaches exact-head human review through the real staged controller', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);

  const dispatch = dispatchSpecificIssue(root, 101);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.issueNumber, 101);
  assert.equal(dispatch.branch, 'ai/issue-101-create-acceptance-marker');
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');
  assert.ok(Number(dispatch.controllerPid) > 0);

  const state = await waitForTerminalRun(root, 101);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 101, { limit: 100 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }
  assert.equal(state.status, 'human-review');
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 7);
  assert.equal(state.attempt, 1);
  assert.ok(state.completedAt);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const head = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  assert.equal(remoteHead, head);
  assert.equal(state.approvedCommit, head);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'golden path completed\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const validation = state.events.find((event) => event.event === 'validation-summary' && event.result === 'PASS');
  const stagedReview = state.events.find((event) => event.event === 'harness-review' && event.stage === 'full' && event.result === 'pass');
  const compatibilityApproval = state.events.find((event) => event.event === 'review' && event.result === 'APPROVED');
  assert.equal(validation?.commit, head);
  assert.equal(stagedReview?.headSha, head);
  assert.equal(stagedReview?.round, 1);
  assert.equal(compatibilityApproval?.commit, head);

  const activityTypes = new Set((state.activity || []).map((entry) => entry.type));
  for (const expected of ['workspace-created', 'workspace-verified', 'agent-started', 'controller-started', 'controller-validation-recorded', 'review-started']) {
    assert.equal(activityTypes.has(expected), true, `missing activity ${expected}`);
  }

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'workspace' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  const reviewerAuditComments = commands.filter((entry) => entry.command === 'gh'
    && entry.args[0] === 'pr'
    && entry.args[1] === 'comment');
  assert.equal(reviewerAuditComments.length, 1);
  assert.equal(reviewerAuditComments[0].args[2], '7');
  assert.equal(commandOption(reviewerAuditComments[0].args, '--body').includes('## Automated Reviewer audit'), true);
  assert.equal(commandOption(reviewerAuditComments[0].args, '--body').includes(`Commit: \`${head}\``), true);
  assert.equal(commandOption(reviewerAuditComments[0].args, '--body').includes('Verdict: **APPROVED**'), true);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'issue' && args[1] === 'comment'), 1);

  const coderRun = commands.find((entry) => entry.command === 'paseo' && entry.args[0] === 'run' && entry.args.includes('--background'));
  const reviewerRun = commands.find((entry) => entry.command === 'paseo' && entry.args[0] === 'run' && !entry.args.includes('--background'));
  assert.equal(commandOption(coderRun.args, '--provider'), 'fixture/coder');
  assert.equal(commandOption(coderRun.args, '--thinking'), 'medium');
  assert.equal(commandOption(reviewerRun.args, '--provider'), 'fixture/reviewer');
  assert.equal(commandOption(reviewerRun.args, '--thinking'), 'high');
  assert.match(reviewerRun.args.at(-1), /This is a FULL review/);

  const issueEdits = commands.filter((entry) => entry.command === 'gh' && entry.args[0] === 'issue' && entry.args[1] === 'edit');
  assert.equal(issueEdits.some((entry) => entry.args.includes('--add-label') && entry.args.includes('agent-running')), true);
  assert.equal(issueEdits.some((entry) => entry.args.includes('--add-label') && entry.args.includes('human-review')), true);
});