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
    'Create the deterministic review-repair marker.',
    '## Required behavior',
    'Commit and push the marker, then repair it if independent review requests changes.',
    '## Acceptance criteria',
    '- The final exact PR head contains the reviewed repair.',
    '## Validation and checks',
    '- Every reviewed head is committed, pushed, clean, and exact-head validated.',
    '## Stop conditions',
    '- Stop if the fixture cannot preserve the same issue branch and pull request.',
  ].join('\n\n');
}

function setupRepository(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-review-repair-acceptance-'));
  const root = path.join(fixture, 'repo');
  const remote = path.join(fixture, 'remote.git');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git(fixture, ['init', '--bare', '--quiet', remote]);
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'Paseo Acceptance']);
  git(root, ['config', 'user.email', 'acceptance@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), '# review repair acceptance fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  git(root, ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);

  const issue = {
    number: 102,
    title: 'Create review repair marker',
    body: issueBody(),
    labels: [{ name: 'paseo:ready' }],
    state: 'OPEN',
    stateReason: '',
    url: 'https://example.invalid/owner/repo/issues/102',
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
  const pr = { number: 8, url: 'https://example.invalid/owner/repo/pull/8', isDraft: true, headRefOid, baseRefName, baseRefOid, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };
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
const prFile = path.join(fixture, 'pr.json');
const externalMode = path.join(fixture, 'external-head-mode');
const reviewerFailureMode = path.join(fixture, 'reviewer-failure-mode');
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
  const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
  const completed = path.join(fixture, 'coder-completed');
  const repairPending = path.join(fixture, 'repair-pending');
  if (!existsSync(completed)) {
    writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'initial reviewed content\\n');
    execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Add initial review marker'], { cwd: workspace.cwd, stdio: 'pipe' });
    execFileSync('git', ['push', '--quiet', '-u', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    writeFileSync(completed, 'done\\n');
  } else if (existsSync(repairPending)) {
    if (existsSync(externalMode)) {
      execFileSync('git', ['fetch', '--quiet', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
      execFileSync('git', ['reset', '--hard', 'origin/' + workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    } else {
      writeFileSync(path.join(workspace.cwd, 'acceptance-marker.txt'), 'review repair completed\\n');
      execFileSync('git', ['add', 'acceptance-marker.txt'], { cwd: workspace.cwd, stdio: 'pipe' });
      execFileSync('git', ['commit', '--quiet', '-m', 'Apply requested review repair'], { cwd: workspace.cwd, stdio: 'pipe' });
      execFileSync('git', ['push', '--quiet', 'origin', workspace.branch], { cwd: workspace.cwd, stdio: 'pipe' });
    }
    const pr = JSON.parse(readFileSync(prFile, 'utf8'));
    pr.headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.cwd, encoding: 'utf8' }).trim();
    writeFileSync(prFile, JSON.stringify(pr, null, 2));
    unlinkSync(repairPending);
  }
  process.exit(0);
}
if (args[0] === 'run') {
  const countFile = path.join(fixture, 'review-count');
  const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0;
  writeFileSync(countFile, String(count + 1));
  if (existsSync(reviewerFailureMode)) {
    process.stderr.write('simulated reviewer failure');
    process.exit(2);
  }
  if (existsSync(externalMode)) {
    if (count === 0) {
      const workspace = JSON.parse(readFileSync(workspaceFile, 'utf8'));
      const external = path.join(fixture, 'external');
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: workspace.cwd, encoding: 'utf8' }).trim();
      execFileSync('git', ['clone', '--quiet', remote, external], { stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'External Contributor'], { cwd: external, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'external@example.invalid'], { cwd: external, stdio: 'pipe' });
      execFileSync('git', ['checkout', '--quiet', workspace.branch], { cwd: external, stdio: 'pipe' });
      writeFileSync(path.join(external, 'external-head.txt'), 'external exact-head change\\n');
      execFileSync('git', ['add', 'external-head.txt'], { cwd: external, stdio: 'pipe' });
      execFileSync('git', ['commit', '--quiet', '-m', 'Advance PR head externally'], { cwd: external, stdio: 'pipe' });
      execFileSync('git', ['push', '--quiet', 'origin', workspace.branch], { cwd: external, stdio: 'pipe' });
      const pr = JSON.parse(readFileSync(prFile, 'utf8'));
      pr.headRefOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: external, encoding: 'utf8' }).trim();
      writeFileSync(prFile, JSON.stringify(pr, null, 2));
    }
    output({ approved: true, findings: 'Reviewer approved the exact head presented for this round.' });
    process.exit(0);
  }
  if (count === 0) { output({ approved: false, findings: 'Replace the initial marker content with the reviewed repair.' }); process.exit(0); }
  output({ approved: true, findings: 'The repaired exact head satisfies review.' });
  process.exit(0);
}
if (args[0] === 'send') { writeFileSync(path.join(fixture, 'repair-pending'), 'repair\\n'); process.exit(0); }
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
    const state = loadRun(root, 102);
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

test('functional acceptance: requested review changes repair the same PR and require approval of the new exact head', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);

  const dispatch = dispatchSpecificIssue(root, 102);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.issueNumber, 102);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 102);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 102, { limit: 120 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }
  assert.equal(state.status, 'human-review');
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 8);
  assert.equal(state.attempt, 1);

  const reviews = (state.events || []).filter((event) => event.event === 'review');
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].result, 'CHANGES_REQUIRED');
  assert.equal(reviews[1].result, 'APPROVED');
  assert.ok(reviews[0].commit);
  assert.ok(reviews[1].commit);
  assert.notEqual(reviews[0].commit, reviews[1].commit);
  assert.equal(state.approvedCommit, reviews[1].commit);

  const validatedCommits = new Set((state.events || [])
    .filter((event) => event.event === 'validation-summary' && event.result === 'PASS')
    .map((event) => event.commit));
  assert.equal(validatedCommits.has(reviews[0].commit), true);
  assert.equal(validatedCommits.has(reviews[1].commit), true);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(finalHead, reviews[1].commit);
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.number, 8);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'review repair completed\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const activityTypes = new Set((state.activity || []).map((entry) => entry.type));
  assert.equal(activityTypes.has('review-changes-required'), true);
  assert.equal(activityTypes.has('controller-validation-recorded'), true);

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 2);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 2);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'issue' && args[1] === 'comment'), 1);
});

test('functional acceptance: an externally advanced PR head invalidates approval and requires fresh exact-head validation and review', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);
  writeFileSync(path.join(fixture, 'external-head-mode'), 'enabled\n');

  const dispatch = dispatchSpecificIssue(root, 102);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.issueNumber, 102);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 102);
  if (state.phase === 'failed') {
    const lifecycle = loadIssueLifecycle(root, 102, { limit: 160 });
    assert.fail(`${state.reason || 'controller entered failed state'}\nLifecycle: ${JSON.stringify(lifecycle, null, 2)}`);
  }
  assert.equal(state.status, 'human-review');
  assert.equal(state.phase, 'human-review');
  assert.equal(state.prNumber, 8);
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

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(finalHead, reviews[1].commit);
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'initial reviewed content\n');
  assert.equal(readFileSync(path.join(worktree, 'external-head.txt'), 'utf8'), 'external exact-head change\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const recovery = (state.activity || []).filter((entry) => entry.type === 'completion-evidence-recovery');
  assert.equal(recovery.length, 1);
  assert.match(recovery[0].details, /Worktree HEAD and pull-request HEAD/);

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 2);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 2);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 2);
});

test('functional acceptance: reviewer subprocess failure fails closed without recording approval', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const { fixture, root } = setupRepository(t);
  writeFileSync(path.join(fixture, 'reviewer-failure-mode'), 'enabled\n');

  const dispatch = dispatchSpecificIssue(root, 102);
  assert.equal(dispatch.claimed, true);
  assert.equal(dispatch.issueNumber, 102);
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.workspaceId, 'workspace-1');

  const state = await waitForTerminalRun(root, 102);
  assert.equal(state.status, 'failed');
  assert.equal(state.phase, 'failed');
  assert.match(String(state.reason || ''), /simulated reviewer failure/);
  assert.equal(state.prNumber, 8);
  assert.equal(state.attempt, 1);
  assert.equal(state.workspaceId, 'workspace-1');
  assert.equal(state.coderAgentId, 'agent-1');
  assert.equal(state.approvedCommit || null, null);

  const validations = (state.events || []).filter((event) => event.event === 'validation-summary' && event.result === 'PASS');
  const reviews = (state.events || []).filter((event) => event.event === 'review');
  assert.equal(validations.length, 1);
  assert.ok(validations[0].commit);
  assert.equal(reviews.length, 0);

  const worktree = JSON.parse(readFileSync(path.join(fixture, 'workspace.json'), 'utf8')).cwd;
  const finalHead = git(worktree, ['rev-parse', 'HEAD']);
  const remoteHead = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${state.branch}`]).split(/\s+/)[0];
  const pr = JSON.parse(readFileSync(path.join(fixture, 'pr.json'), 'utf8'));
  assert.equal(pr.isDraft, true);
  assert.equal(finalHead, validations[0].commit);
  assert.equal(remoteHead, finalHead);
  assert.equal(pr.headRefOid, finalHead);
  assert.equal(readFileSync(path.join(worktree, 'acceptance-marker.txt'), 'utf8'), 'initial reviewed content\n');
  assert.equal(git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']), '');

  const activityTypes = new Set((state.activity || []).map((entry) => entry.type));
  assert.equal(activityTypes.has('controller-validation-recorded'), true);
  assert.equal(activityTypes.has('review-started'), true);
  assert.equal(activityTypes.has('review-changes-required'), false);

  const commands = commandLog(fixture);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'create'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'wait'), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'run' && !args.includes('--background')), 1);
  assert.equal(countCommands(commands, 'paseo', (args) => args[0] === 'send'), 0);
  assert.equal(countCommands(commands, 'gh', (args) => args[0] === 'pr' && args[1] === 'comment'), 0);
});
