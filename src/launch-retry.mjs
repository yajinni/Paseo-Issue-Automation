import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { findFirstKey, run } from './process.mjs';

export const AGENT_START_MAX_ATTEMPTS = 3;
export const LAUNCH_RECONCILIATION_MAX_ATTEMPTS = 3;
export const PASEO_WORKTREE_SLUG_MAX_LENGTH = 50;

const OBSOLETE_NO_RECOVERY_INSTRUCTION = 'This attempt cannot be resumed or recovered. If interrupted, it will be abandoned and restarted fresh.';
const RECOVER_FIRST_INSTRUCTION = 'Do not create an ad-hoc replacement workspace, branch, or duplicate coder. If Paseo’s controller explicitly requests recover-first continuation, resume this recorded attempt in place using the existing workspace, branch, and coder; otherwise follow the controller lifecycle instructions.';

export function nextReconciliationAttempt(current = 0) {
  const previous = Number(current);
  const normalized = Number.isInteger(previous) && previous >= 0 ? previous : 0;
  const attempt = normalized + 1;
  return {
    attempt,
    maximum: LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
    exhausted: attempt >= LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
  };
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function expandedPath(value) {
  const raw = text(value);
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function normalizedPath(value) {
  const resolved = path.resolve(expandedPath(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function pathBelongsToWorkspace(workspacePath, candidatePath) {
  if (!text(workspacePath) || !text(candidatePath)) return false;
  const workspace = normalizedPath(workspacePath);
  const candidate = normalizedPath(candidatePath);
  const relative = path.relative(workspace, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function worktreeSlugForBranch(branch) {
  const raw = text(branch);
  if (!raw) throw new Error('A Git branch is required to derive the Paseo worktree slug.');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  const issue = /(?:^|\/)issue-(\d+)(?:-|$)/.exec(raw)?.[1] || null;
  const attempt = /-attempt-(\d+)$/.exec(raw)?.[1] || '1';
  const readable = issue ? `pia-i${issue}-a${attempt}-${digest}` : `pia-${digest}`;
  return readable.length <= PASEO_WORKTREE_SLUG_MAX_LENGTH ? readable : `pia-${digest}`;
}

export function workspaceCreateArgs({ root, title, branch, baseBranch, baseSha = null }) {
  return [
    'workspace', 'create', '--json',
    '--isolation', 'worktree', '--path', String(root),
    '--worktree-slug', worktreeSlugForBranch(branch),
    '--title', String(title), '--mode', 'branch-off',
    '--new-branch', String(branch), '--base', String(baseSha || baseBranch),
  ];
}

export function normalizeAttemptPrompt(prompt) {
  return String(prompt).replace(OBSOLETE_NO_RECOVERY_INSTRUCTION, RECOVER_FIRST_INSTRUCTION);
}

export function agentRunArgs({ provider, thinking, title, workspaceId, prompt }) {
  const args = ['run', '--background', '--json', '--provider', String(provider)];
  if (thinking) args.push('--thinking', String(thinking));
  args.push('--title', String(title), '--workspace', String(workspaceId), normalizeAttemptPrompt(prompt));
  return args;
}

export function workspaceFromPayload(payload) {
  return {
    workspaceId: text(findFirstKey(payload, ['workspaceId', 'workspace_id'])),
    worktreePath: text(findFirstKey(payload, ['cwd', 'worktreePath', 'worktree_path', 'path'])),
    workspaceName: text(findFirstKey(payload, ['name', 'title'])),
  };
}

export function agentRowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === 'object');
  const candidate = findFirstKey(payload, ['data', 'agents', 'items', 'entries']);
  if (Array.isArray(candidate)) return candidate.filter((item) => item && typeof item === 'object');
  return [];
}

function parseJsonOutput(result) {
  if (!result?.ok || !text(result.stdout)) return null;
  try { return JSON.parse(result.stdout); }
  catch { return null; }
}

export function inspectWorkspaceAgents(root, worktreePath, { runner = run } = {}) {
  const result = runner('paseo', ['ls', '-a', '-g', '--json'], { cwd: root, allowFailure: true });
  const payload = parseJsonOutput(result);
  if (!payload) {
    return {
      verified: false,
      agents: [],
      reason: text(result?.stderr) || text(result?.stdout) || 'Paseo agent inventory could not be read.',
    };
  }
  return {
    verified: true,
    agents: agentRowsFromPayload(payload).filter((agent) => pathBelongsToWorkspace(worktreePath, agent.cwd)),
    reason: null,
  };
}

export function expectedWorkspaceAgent(inspection, title) {
  if (!inspection?.verified) return { status: 'unverified', agent: null };
  const matches = inspection.agents.filter((agent) => text(agent.name ?? agent.title) === text(title));
  if (matches.length === 1) return { status: 'found', agent: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', agent: null, agents: matches };
  if (inspection.agents.length) return { status: 'nonempty', agent: null, agents: inspection.agents };
  return { status: 'empty', agent: null, agents: [] };
}

export function verifyWorkspaceIdentity(root, workspace, expected, { runner = run } = {}) {
  if (!workspace.workspaceId) throw new Error('Paseo workspace creation did not return a workspace ID.');
  if (!workspace.worktreePath) throw new Error('Paseo workspace creation did not return a worktree path.');
  if (workspace.workspaceName && workspace.workspaceName !== expected.title) {
    throw new Error(`Paseo created workspace ${workspace.workspaceName} instead of ${expected.title}.`);
  }
  const branchResult = runner('git', ['-C', workspace.worktreePath, 'branch', '--show-current'], {
    cwd: root,
    allowFailure: true,
  });
  if (!branchResult?.ok) {
    throw new Error(text(branchResult?.stderr) || text(branchResult?.stdout) || 'Could not verify the created worktree branch.');
  }
  const actualBranch = text(branchResult.stdout);
  if (actualBranch !== expected.branch) {
    throw new Error(`Paseo created branch ${actualBranch || '(detached)'} instead of ${expected.branch}.`);
  }
  if (expected.baseSha) {
    const headResult = runner('git', ['-C', workspace.worktreePath, 'rev-parse', 'HEAD'], {
      cwd: root,
      allowFailure: true,
    });
    if (!headResult?.ok) {
      throw new Error(text(headResult?.stderr) || text(headResult?.stdout) || 'Could not verify the created worktree base commit.');
    }
    const actualHead = text(headResult.stdout).toLowerCase();
    if (actualHead !== text(expected.baseSha).toLowerCase()) {
      throw new Error(`Paseo created worktree HEAD ${actualHead || '(unknown)'} instead of verified base ${expected.baseSha}.`);
    }
  }
  return workspace;
}

export function refreshConfiguredBase(root, baseBranch, { runner = run, remote = 'origin', now = () => new Date().toISOString() } = {}) {
  const branch = text(baseBranch);
  if (!branch || branch.startsWith('-') || branch.includes('..') || branch.includes('@{')) {
    throw new Error('The configured base branch is invalid or missing.');
  }
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  const fetch = runner('git', ['fetch', '--prune', remote, `+refs/heads/${branch}:${remoteRef}`], {
    cwd: root,
    allowFailure: true,
  });
  if (!fetch?.ok) {
    throw new Error(`Could not fetch origin/${branch} before workspace creation: ${text(fetch?.stderr) || text(fetch?.stdout) || 'git fetch failed.'}`);
  }
  const resolved = runner('git', ['rev-parse', `${remoteRef}^{commit}`], { cwd: root, allowFailure: true });
  if (!resolved?.ok || !/^[0-9a-f]{40}$/i.test(text(resolved.stdout))) {
    throw new Error(`Could not resolve the freshly fetched origin/${branch} commit SHA.`);
  }
  const baseSha = text(resolved.stdout).toLowerCase();
  const remoteHead = runner('git', ['ls-remote', remote, `refs/heads/${branch}`], { cwd: root, allowFailure: true });
  if (!remoteHead?.ok) {
    throw new Error(`Could not verify the current origin/${branch} commit SHA: ${text(remoteHead?.stderr) || text(remoteHead?.stdout) || 'git ls-remote failed.'}`);
  }
  const remoteSha = text(remoteHead.stdout).split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(remoteSha) || remoteSha !== baseSha) {
    throw new Error(`Fresh origin/${branch} verification failed: fetched ${baseSha || '(missing)'} but remote reports ${remoteSha || '(missing)'}.`);
  }
  return { baseBranch: branch, baseRef: remoteRef, baseSha, verifiedAt: now() };
}

export function cleanupWorkspaceIfEmpty(root, workspace, { runner = run } = {}) {
  if (!workspace?.workspaceId || !workspace?.worktreePath) {
    return { status: 'not-applicable', archived: false, reason: 'No recorded workspace is available.' };
  }
  const inspection = inspectWorkspaceAgents(root, workspace.worktreePath, { runner });
  if (!inspection.verified) {
    return { status: 'skipped-unverified', archived: false, reason: inspection.reason };
  }
  if (inspection.agents.length) {
    return {
      status: 'skipped-nonempty',
      archived: false,
      reason: `${inspection.agents.length} agent(s) still belong to the workspace.`,
      agentIds: inspection.agents.map((agent) => agent.id).filter(Boolean),
    };
  }
  const archived = runner('paseo', ['workspace', 'archive', String(workspace.workspaceId)], {
    cwd: root,
    allowFailure: true,
  });
  if (!archived?.ok) {
    return {
      status: 'archive-failed',
      archived: false,
      reason: text(archived?.stderr) || text(archived?.stdout) || 'Paseo workspace archive failed.',
    };
  }
  return { status: 'archived-empty', archived: true, reason: null };
}

export function launchErrorDetail(error) {
  return text(error?.stderr) || text(error?.stdout) || text(error?.message) || String(error);
}
