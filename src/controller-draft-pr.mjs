import { loadConfig } from './state.mjs';
import { run, runJson } from './process.mjs';

const PR_JSON_FIELDS = 'number,url,isDraft,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,statusCheckRollup';

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function currentPr(root, state, {
  runJsonFn = runJson,
  configLoader = loadConfig,
} = {}) {
  const prs = runJsonFn('gh', [
    'pr', 'list', '--state', 'open', '--head', state.branch, '--limit', '10',
    '--json', PR_JSON_FIELDS,
  ], { cwd: root, allowFailure: true }) || [];
  const baseBranch = configLoader(root).baseBranch;
  return prs.find((pr) => pr.baseRefName === baseBranch) || prs[0] || null;
}

export function remoteBranchHead(root, branch, { runner = run } = {}) {
  const ref = `refs/heads/${branch}`;
  const result = runner('git', ['ls-remote', '--heads', 'origin', ref], { cwd: root, allowFailure: true });
  if (!result?.ok) return null;
  const line = text(result.stdout).split(/\r?\n/).find((entry) => entry.endsWith(`\t${ref}`));
  return line ? text(line.split(/\s+/)[0]) : null;
}

function branchNotPushedError(state, headSha, detail = '') {
  const suffix = text(detail) ? ` ${text(detail)}` : '';
  const error = new Error(`Coder finished without pushing ${state.branch} to the exact local HEAD ${headSha}.${suffix}`);
  error.code = 'CODER_BRANCH_NOT_PUSHED';
  return error;
}

function controllerBaseProofRef(state) {
  const issueNumber = Number(state.issueNumber);
  return `refs/paseo/controller-base/${Number.isInteger(issueNumber) && issueNumber > 0 ? issueNumber : 0}`;
}

function verifyFallbackPushCandidate(root, state, headSha, baseBranch, baseHead, { runner = run } = {}) {
  const cwd = state.worktreePath || root;
  const proofRef = controllerBaseProofRef(state);
  const fetched = runner('git', [
    'fetch', '--no-tags', 'origin', `+refs/heads/${baseBranch}:${proofRef}`,
  ], { cwd, allowFailure: true });
  if (!fetched?.ok) {
    throw branchNotPushedError(
      state,
      headSha,
      fetched?.stderr || fetched?.stdout || `Could not fetch the current ${baseBranch} head for fallback-push verification.`,
    );
  }

  const fetchedBase = runner('git', ['rev-parse', proofRef], { cwd, allowFailure: true });
  if (!fetchedBase?.ok || text(fetchedBase.stdout) !== baseHead) {
    throw branchNotPushedError(
      state,
      headSha,
      `The freshly fetched ${baseBranch} head did not match the remote head used for fallback-push verification.`,
    );
  }

  const uniqueCommits = runner('git', ['rev-list', '--count', `${proofRef}..${headSha}`], {
    cwd,
    allowFailure: true,
  });
  const uniqueCount = Number(text(uniqueCommits?.stdout));
  if (!uniqueCommits?.ok || !Number.isInteger(uniqueCount) || uniqueCount < 1) {
    throw branchNotPushedError(
      state,
      headSha,
      `The local head has no issue commit that is not already reachable from the current ${baseBranch} head.`,
    );
  }

  const branch = runner('git', ['branch', '--show-current'], { cwd, allowFailure: true });
  const actualBranch = branch?.ok ? text(branch.stdout) : '';
  if (!branch?.ok || actualBranch !== state.branch) {
    throw branchNotPushedError(
      state,
      headSha,
      `The issue worktree is on ${actualBranch || '(detached)'} instead of the recorded branch ${state.branch}.`,
    );
  }

  const currentHead = runner('git', ['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  if (!currentHead?.ok || text(currentHead.stdout) !== headSha) {
    throw branchNotPushedError(
      state,
      headSha,
      `The issue worktree HEAD changed before the controller fallback push.`,
    );
  }
}

export function ensureRemoteBranchHead(root, state, headSha, {
  runner = run,
  configLoader = loadConfig,
} = {}) {
  let remoteHead = remoteBranchHead(root, state.branch, { runner });
  if (remoteHead === headSha) return { head: remoteHead, pushed: false };

  const config = configLoader(root);
  const baseHead = remoteBranchHead(root, config.baseBranch, { runner });
  if (!baseHead || baseHead === headSha) {
    throw branchNotPushedError(state, headSha);
  }

  verifyFallbackPushCandidate(root, state, headSha, config.baseBranch, baseHead, { runner });

  const cwd = state.worktreePath || root;
  const pushed = runner('git', [
    'push', '--set-upstream', 'origin', `HEAD:refs/heads/${state.branch}`,
  ], { cwd, allowFailure: true });
  if (!pushed?.ok) {
    throw branchNotPushedError(
      state,
      headSha,
      pushed?.stderr || pushed?.stdout || 'The controller fallback push failed.',
    );
  }

  remoteHead = remoteBranchHead(root, state.branch, { runner });
  if (remoteHead !== headSha) {
    throw branchNotPushedError(
      state,
      headSha,
      `The controller fallback push completed, but the remote branch resolved to ${remoteHead || 'no head'}.`,
    );
  }
  return { head: remoteHead, pushed: true };
}

export function controllerDraftPrBody({ issueNumber, baseBranch, baseSha, branch, headSha, changedFiles = [] }) {
  const files = changedFiles.length
    ? changedFiles.map((file) => `- \`${file}\``).join('\n')
    : '- Changed files could not be enumerated automatically.';
  return `Closes #${issueNumber}\n\n## Controller-created draft handoff\n\nPaseo Issue Automation created this draft PR after the coder returned with a clean worktree and the pushed branch head matched local HEAD.\n\n- Issue: #${issueNumber}\n- Base: \`${baseBranch}\` @ \`${baseSha || 'not-recorded'}\`\n- Head: \`${branch}\` @ \`${headSha}\`\n\n## Changed files\n\n${files}\n\n## Validation and completion evidence\n\nThe coder remains responsible for the issue-required validation and substantive completion evidence. Independent review and GitHub CI still gate progression. If issue-specific PR evidence is missing from this scaffold, the review/fix cycle must add it before human review.\n`;
}

function changedFiles(root, state, baseSha, headSha, { runner = run } = {}) {
  const cwd = state.worktreePath || root;
  if (!baseSha) return [];
  const result = runner('git', ['diff', '--name-only', `${baseSha}...${headSha}`], { cwd, allowFailure: true });
  if (!result?.ok) return [];
  return text(result.stdout).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

export function ensureDraftPr(root, issueNumber, state, headSha, {
  runner = run,
  runJsonFn = runJson,
  configLoader = loadConfig,
} = {}) {
  const existing = currentPr(root, state, { runJsonFn, configLoader });
  if (existing) return { pr: existing, created: false };

  ensureRemoteBranchHead(root, state, headSha, { runner, configLoader });

  const config = configLoader(root);
  const baseSha = remoteBranchHead(root, config.baseBranch, { runner });
  const files = changedFiles(root, state, baseSha, headSha, { runner });
  const body = controllerDraftPrBody({
    issueNumber,
    baseBranch: config.baseBranch,
    baseSha,
    branch: state.branch,
    headSha,
    changedFiles: files,
  });
  const cwd = state.worktreePath || root;
  const created = runner('gh', [
    'pr', 'create', '--draft',
    '--head', state.branch,
    '--base', config.baseBranch,
    '--title', state.issueTitle || `Issue #${issueNumber}`,
    '--body', body,
  ], { cwd, allowFailure: true });

  if (!created?.ok) {
    const raced = currentPr(root, state, { runJsonFn, configLoader });
    if (raced) return { pr: raced, created: false };
    throw new Error(created?.stderr || created?.stdout || `Could not create a draft pull request for ${state.branch}.`);
  }

  const pr = currentPr(root, state, { runJsonFn, configLoader });
  if (!pr) throw new Error(`GitHub reported draft PR creation for ${state.branch}, but the controller could not read it back.`);
  return { pr, created: true };
}
