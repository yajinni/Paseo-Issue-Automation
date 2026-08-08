import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { loadRun } from '../src/state.mjs';

const cliPath = fileURLToPath(new URL('../bin/paseo-issue-automation.mjs', import.meta.url));

function text(value) {
  return String(value ?? '').trim();
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function parseSmokeOptions(argv) {
  const options = {
    root: process.cwd(),
    timeoutSeconds: 1200,
    pollSeconds: 5,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--root') options.root = argv[++index];
    else if (value === '--timeout-seconds') options.timeoutSeconds = integer(argv[++index], options.timeoutSeconds);
    else if (value === '--poll-seconds') options.pollSeconds = integer(argv[++index], options.pollSeconds);
    else throw new Error(`Unknown option: ${value}`);
  }
  options.root = path.resolve(options.root || process.cwd());
  return options;
}

export function buildSmokeIssueBody(fileName, exactContent) {
  const escapedContent = JSON.stringify(exactContent);
  return [
    '<!-- paseo-issue-template:v2 -->',
    '## Objective',
    `Create \`${fileName}\` as a disposable real-GitHub/Paseo smoke artifact.`,
    '## Required behavior',
    `Create exactly one new file at \`${fileName}\` with the exact UTF-8 contents represented by ${escapedContent}. Do not change unrelated files.`,
    '## Acceptance criteria',
    `- \`${fileName}\` exists on the issue branch.`,
    `- Its contents exactly equal ${escapedContent}.`,
    '- The worktree is clean after the change is committed and pushed.',
    '- A draft pull request targets the configured base branch.',
    '## Validation and checks',
    `- Run a Node command that reads \`${fileName}\` and exits nonzero unless its contents exactly match ${escapedContent}.`,
    '- Run any repository-required checks that apply to this one-file change.',
    '## Stop conditions',
    '- Stop rather than modify unrelated product code if repository instructions conflict with this disposable smoke task.',
  ].join('\n\n');
}

function help() {
  return `Disposable GitHub/Paseo smoke\n\nUsage:\n  PASEO_LIVE_SMOKE=1 PASEO_LIVE_SMOKE_REPOSITORY=owner/disposable-repo \\\n    node scripts/disposable-github-smoke.mjs --root /path/to/disposable-clone\n\nOptions:\n  --root PATH             Configured disposable repository clone (default: cwd)\n  --timeout-seconds N     Maximum lifecycle wait (default: 1200)\n  --poll-seconds N        Status poll interval (default: 5)\n  --help                   Show this message\n\nSafety:\n  The script refuses to run unless PASEO_LIVE_SMOKE=1 and the actual GitHub\n  repository exactly matches PASEO_LIVE_SMOKE_REPOSITORY. It creates a real\n  issue, branch, agent workspace, and draft PR. It does not merge or clean up\n  the resulting PR/issue so they remain available for inspection.\n`;
}

function run(command, args, { cwd, json = false } = {}) {
  let stdout;
  try {
    stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (error) {
    const stderr = text(error?.stderr);
    const output = text(error?.stdout);
    throw new Error(`${command} ${args.join(' ')} failed${stderr || output ? `: ${stderr || output}` : ''}`);
  }
  const output = text(stdout);
  if (!json) return output;
  try { return JSON.parse(output); }
  catch { throw new Error(`${command} ${args.join(' ')} did not return valid JSON.`); }
}

function automationStatus(root) {
  return run(process.execPath, [cliPath, 'status'], { cwd: root, json: true });
}

function attemptFor(status, issueNumber) {
  return (status?.automation?.attempts || []).find((attempt) => Number(attempt.issueNumber) === Number(issueNumber)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHumanReview(root, issueNumber, { timeoutSeconds, pollSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const status = automationStatus(root);
    last = attemptFor(status, issueNumber);
    if (last?.phase === 'human-review' && last?.prNumber) return { status, attempt: last };
    if (['failed', 'launch-failed', 'blocked', 'abandoned'].includes(String(last?.phase || ''))) {
      throw new Error(`Smoke issue #${issueNumber} ended in ${last.phase}: ${last.reason || 'no reason recorded'}`);
    }
    await sleep(pollSeconds * 1000);
  }
  throw new Error(`Timed out waiting for smoke issue #${issueNumber}; latest phase was ${last?.phase || 'missing'}.`);
}

function requireExplicitDisposableRepository(root) {
  if (process.env.PASEO_LIVE_SMOKE !== '1') {
    throw new Error('Refusing live mutation: set PASEO_LIVE_SMOKE=1 only for an intentional disposable-repository run.');
  }
  const expected = text(process.env.PASEO_LIVE_SMOKE_REPOSITORY);
  if (!expected) throw new Error('PASEO_LIVE_SMOKE_REPOSITORY=owner/repo is required.');

  const gitRoot = run('git', ['rev-parse', '--show-toplevel'], { cwd: root });
  if (comparablePath(gitRoot) !== comparablePath(root)) throw new Error(`--root must be the repository root. Git reports ${gitRoot}.`);
  const repository = run('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root, json: true })?.nameWithOwner;
  if (repository !== expected) {
    throw new Error(`Refusing live mutation: expected ${expected}, but ${root} resolves to ${repository || 'an unknown repository'}.`);
  }
  if (run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root })) {
    throw new Error('Disposable repository worktree must be clean before the live smoke starts.');
  }
  return repository;
}

export async function runDisposableGithubSmoke(options) {
  const root = options.root;
  const repository = requireExplicitDisposableRepository(root);
  const before = automationStatus(root);
  const config = before?.automation?.config;
  if (!config?.setupComplete) throw new Error('Paseo setup is not complete for the disposable repository.');
  if (!config?.baseBranch) throw new Error('The disposable repository has no configured base branch.');
  if (before?.prReviews?.config?.enabled) {
    throw new Error('Disable managed/browser PR review for this smoke so the direct reviewer path terminates at human-review deterministically.');
  }

  const marker = `${Date.now()}-${process.pid}`;
  const fileName = `paseo-live-smoke-${marker}.txt`;
  const exactContent = `Paseo live smoke ${marker}\n`;
  const body = buildSmokeIssueBody(fileName, exactContent);
  const temp = mkdtempSync(path.join(os.tmpdir(), 'paseo-live-smoke-'));
  const bodyFile = path.join(temp, 'issue.md');
  writeFileSync(bodyFile, body, 'utf8');

  let issueUrl;
  try {
    issueUrl = run('gh', [
      'issue', 'create',
      '--title', `Paseo disposable live smoke ${marker}`,
      '--body-file', bodyFile,
      '--label', 'paseo:ready',
    ], { cwd: root });
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  const issueMatch = /\/issues\/(\d+)(?:\D|$)/.exec(issueUrl);
  if (!issueMatch) throw new Error(`Could not determine the created issue number from: ${issueUrl}`);
  const issueNumber = Number(issueMatch[1]);

  run(process.execPath, [cliPath, 'start-issue', '--issue', String(issueNumber)], { cwd: root, json: true });
  const settled = await waitForHumanReview(root, issueNumber, options);
  const attempt = settled.attempt;
  const persisted = loadRun(root, issueNumber);
  const pr = run('gh', [
    'pr', 'view', String(attempt.prNumber),
    '--json', 'number,url,isDraft,headRefOid,baseRefName',
  ], { cwd: root, json: true });

  if (!persisted || persisted.phase !== 'human-review') throw new Error(`Persisted smoke state did not settle at human-review for issue #${issueNumber}.`);
  if (!pr?.isDraft) throw new Error(`Smoke PR #${attempt.prNumber} is not draft.`);
  if (pr.baseRefName !== config.baseBranch) {
    throw new Error(`Smoke PR targets ${pr.baseRefName} instead of configured base ${config.baseBranch}.`);
  }
  if (!persisted.approvedCommit || pr.headRefOid !== persisted.approvedCommit) {
    throw new Error(`Smoke PR head ${pr.headRefOid || 'missing'} does not match approved commit ${persisted.approvedCommit || 'missing'}.`);
  }

  return {
    ok: true,
    repository,
    issueNumber,
    issueUrl,
    pullRequestNumber: Number(pr.number),
    pullRequestUrl: pr.url,
    branch: persisted.branch,
    approvedCommit: persisted.approvedCommit,
    baseBranch: config.baseBranch,
    artifact: fileName,
  };
}

async function main() {
  const options = parseSmokeOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    return;
  }
  const result = await runDisposableGithubSmoke(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}