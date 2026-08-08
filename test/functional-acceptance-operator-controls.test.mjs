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
import {
  abandonAttempt,
  branchForAttempt,
  dispatchSpecificIssue,
} from '../src/attempts.mjs';
import { LABELS, loadRun, saveConfig, saveRun, saveRuntime } from '../src/state.mjs';

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
    'Exercise explicit operator attempt controls.',
    '## Required behavior',
    'Preserve work unless the operator explicitly selects a safe recorded-branch deletion.',
    '## Acceptance criteria',
    '- Abandon stops the current attempt without deleting its branch.',
    '- Delete refuses a recorded branch with an open pull request.',
    '## Validation and checks',
    '- Verify local state, command side effects, and Git refs.',
    '## Stop conditions',
    '- Stop before deleting any branch that is not the recorded attempt branch.',
  ].join('\n\n');
}

function commandLog(fixture) {
  const file = path.join(fixture, 'commands.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function localBranchExists(root, branch) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function remoteBranchExists(root, branch) {
  return Boolean(git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]));
}

function setupRepository(t, { openPr = false } = {}) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-operator-controls-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });

  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# operator control fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);

  const issue = {
    number: 202,
    title: 'Operator branch handling',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/202',
    createdAt: new Date(0).toISOString(),
    blockedBy: { nodes: [], totalCount: 0 },
    blocking: { nodes: [], totalCount: 0 },
    closedByPullRequestsReferences: [],
    comments: [],
  };
  writeFileSync(path.join(fixture, 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);
  if (openPr) writeFileSync(path.join(fixture, 'open-pr'), 'yes\n');

  const oldBranch = branchForAttempt(issue.number, issue.title, 1);
  const unrelatedBranch = 'ai/unrelated-preserve';
  git(root, ['branch', oldBranch, 'main']);
  git(root, ['branch', unrelatedBranch, 'main']);
  git(root, ['push', '--quiet', 'origin', oldBranch]);
  git(root, ['push', '--quiet', 'origin', unrelatedBranch]);

  const ghScript = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const fixture = process.env.PASEO_OPERATOR_FIXTURE;
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'gh', args, cwd: process.cwd() }) + '\\n');
const issue = JSON.parse(readFileSync(path.join(fixture, 'issue.json'), 'utf8'));
const output = (value) => process.stdout.write(JSON.stringify(value));
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
if (args[0] === 'repo' && args[1] === 'view') { output({ nameWithOwner: 'owner/repo' }); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'view') { output(issue); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') { output([]); process.exit(0); }
if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'comment')) process.exit(0);
if (args[0] === 'pr' && args[1] === 'list') {
  const hasOpenPr = existsSync(path.join(fixture, 'open-pr'));
  const head = arg('--head');
  output(hasOpenPr && head === ${JSON.stringify(oldBranch)}
    ? [{ number: 17, url: 'https://example.invalid/owner/repo/pull/17' }]
    : []);
  process.exit(0);
}
process.stderr.write('Unhandled fake gh command: ' + args.join(' '));
process.exit(2);
`;

  const paseoScript = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const fixture = process.env.PASEO_OPERATOR_FIXTURE;
const args = process.argv.slice(2);
appendFileSync(path.join(fixture, 'commands.log'), JSON.stringify({ command: 'paseo', args, cwd: process.cwd() }) + '\\n');
if (args[0] === 'stop') process.exit(0);
if (args[0] === 'workspace' && args[1] === 'archive') process.exit(0);
if (args[0] === 'workspace' && args[1] === 'create') {
  process.stderr.write('intentional fixture stop after branch selection');
  process.exit(3);
}
process.stderr.write('Unhandled fake paseo command: ' + args.join(' '));
process.exit(2);
`;

  writeExecutable(path.join(bin, 'gh'), ghScript);
  writeExecutable(path.join(bin, 'paseo'), paseoScript);

  const previous = {
    PATH: process.env.PATH,
    fixture: process.env.PASEO_OPERATOR_FIXTURE,
  };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
  process.env.PASEO_OPERATOR_FIXTURE = fixture;

  saveConfig(root, {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 60,
    maxActive: 2,
    codingHarness: 'fake',
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 0 },
    review: { workflow: 'full-immediate', quickMaxRounds: 2, fullMaxRounds: 2, autoMergeApproved: false },
    models: { coder: 'fixture/coder', reviewer: 'fixture/reviewer' },
  });
  saveRuntime(root, { claimsEnabled: true, skippedIssueNumbers: [] });

  t.after(() => {
    process.env.PATH = previous.PATH;
    if (previous.fixture === undefined) delete process.env.PASEO_OPERATOR_FIXTURE;
    else process.env.PASEO_OPERATOR_FIXTURE = previous.fixture;
    rmSync(fixture, { recursive: true, force: true });
  });

  return { fixture, root, issue, oldBranch, unrelatedBranch };
}

function saveCompletedAttempt(root, issue, oldBranch, extra = {}) {
  return saveRun(root, issue.number, {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueUrl: issue.url,
    branch: oldBranch,
    attempt: 1,
    status: LABELS.failed,
    phase: 'failed',
    reason: 'fixture terminal attempt',
    startedAt: new Date(1).toISOString(),
    completedAt: new Date(2).toISOString(),
    updatedAt: new Date(2).toISOString(),
    events: [],
    activity: [],
    ...extra,
  });
}

test('functional acceptance: abandon stops and archives the recorded attempt while preserving its branch', (t) => {
  const { fixture, root, issue, oldBranch } = setupRepository(t);
  saveCompletedAttempt(root, issue, oldBranch, {
    status: LABELS.running,
    phase: 'coding',
    completedAt: null,
    coderAgentId: 'coder-202',
    agentId: 'coder-202',
    workspaceId: 'workspace-202',
  });

  const state = abandonAttempt(root, issue.number, 'operator requested stop');
  assert.equal(state.status, 'abandoned');
  assert.equal(state.phase, 'abandoned');
  assert.equal(state.reason, 'operator requested stop');
  assert.ok(state.completedAt);
  assert.equal(state.activity.at(-1)?.type, 'attempt-abandoned');
  assert.equal(loadRun(root, issue.number).phase, 'abandoned');
  assert.equal(localBranchExists(root, oldBranch), true);
  assert.equal(remoteBranchExists(root, oldBranch), true);

  const commands = commandLog(fixture);
  assert.ok(commands.some((entry) => entry.command === 'paseo' && entry.args[0] === 'stop' && entry.args[1] === 'coder-202'));
  assert.ok(commands.some((entry) => entry.command === 'paseo' && entry.args[0] === 'workspace' && entry.args[1] === 'archive' && entry.args[2] === 'workspace-202'));
  assert.ok(commands.some((entry) => entry.command === 'gh' && entry.args[0] === 'issue' && entry.args[1] === 'comment' && entry.args.includes('operator requested stop')));
  assert.equal(commands.some((entry) => entry.command === 'paseo' && entry.args[0] === 'workspace' && entry.args[1] === 'create'), false);
});

test('functional acceptance: delete branch action refuses the recorded branch when it has an open pull request', (t) => {
  const { fixture, root, issue, oldBranch, unrelatedBranch } = setupRepository(t, { openPr: true });
  saveCompletedAttempt(root, issue, oldBranch);

  assert.throws(
    () => dispatchSpecificIssue(root, issue.number, { branchAction: 'delete' }),
    /open pull request/i,
  );

  const state = loadRun(root, issue.number);
  assert.equal(state.attempt, 1);
  assert.equal(state.branch, oldBranch);
  assert.equal(localBranchExists(root, oldBranch), true);
  assert.equal(remoteBranchExists(root, oldBranch), true);
  assert.equal(localBranchExists(root, unrelatedBranch), true);
  assert.equal(remoteBranchExists(root, unrelatedBranch), true);
  assert.equal(commandLog(fixture).some((entry) => entry.command === 'paseo'), false);
});

test('functional acceptance: delete branch action removes only the recorded safe branch before a fresh attempt', (t) => {
  const { fixture, root, issue, oldBranch, unrelatedBranch } = setupRepository(t);
  saveCompletedAttempt(root, issue, oldBranch);

  const result = dispatchSpecificIssue(root, issue.number, { branchAction: 'delete' });
  assert.equal(result.failed, true);
  assert.equal(result.attempt, 2);
  assert.match(result.reason, /intentional fixture stop after branch selection/i);

  assert.equal(localBranchExists(root, oldBranch), false);
  assert.equal(remoteBranchExists(root, oldBranch), false);
  assert.equal(localBranchExists(root, unrelatedBranch), true);
  assert.equal(remoteBranchExists(root, unrelatedBranch), true);

  const state = loadRun(root, issue.number);
  assert.equal(state.attempt, 2);
  assert.equal(state.branch, branchForAttempt(issue.number, issue.title, 2));
  assert.equal(state.phase, 'launch-failed');
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].branch, oldBranch);

  const commands = commandLog(fixture);
  assert.equal(commands.filter((entry) => entry.command === 'paseo' && entry.args[0] === 'workspace' && entry.args[1] === 'create').length, 1);
});
