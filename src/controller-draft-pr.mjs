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

  const remoteHead = remoteBranchHead(root, state.branch, { runner });
  if (!remoteHead || remoteHead !== headSha) {
    const error = new Error(`Coder finished without pushing ${state.branch} to the exact local HEAD ${headSha}.`);
    error.code = 'CODER_BRANCH_NOT_PUSHED';
    throw error;
  }

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
