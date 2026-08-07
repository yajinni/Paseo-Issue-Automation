import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeGitRemote } from './repository-checkouts.mjs';

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); }
  catch { return null; }
}

function workspaceRows(value) {
  if (Array.isArray(value)) return value.flatMap(workspaceRows);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.workspaces)) return value.workspaces.flatMap(workspaceRows);
  if (Array.isArray(value.items)) return value.items.flatMap(workspaceRows);
  if (value.id || value.workspaceId || value.path || value.directory || value.cwd) return [value];
  return Object.values(value).flatMap(workspaceRows);
}

function workspaceId(value) {
  return value?.id || value?.workspaceId || value?.workspace_id || null;
}

function workspacePath(value) {
  for (const key of ['path', 'directory', 'cwd', 'repositoryPath', 'root']) {
    const candidate = String(value?.[key] || '').trim();
    if (candidate) return path.resolve(candidate);
  }
  return null;
}

function workspaceRemote(value) {
  for (const key of ['remote', 'repositoryRemote', 'origin', 'gitRemote']) {
    const candidate = String(value?.[key] || '').trim();
    if (candidate) return candidate;
  }
  return null;
}

function workspaceBranch(value) {
  for (const key of ['baseBranch', 'base_branch', 'branch', 'branchName']) {
    const candidate = String(value?.[key] || '').trim();
    if (candidate) return candidate;
  }
  return null;
}

function workspaceIsolation(value) {
  return String(value?.isolation || value?.kind || value?.type || '').trim().toLowerCase() || null;
}

function normalizedPath(value, platform = process.platform) {
  if (!value) return null;
  const resolved = path.resolve(String(value));
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function remoteIdentity(remote) {
  return normalizeGitRemote(remote)?.identity || null;
}

function normalizeWorkspace(value, platform = process.platform) {
  return {
    id: workspaceId(value) ? String(workspaceId(value)) : null,
    title: value?.title ? String(value.title) : value?.name ? String(value.name) : null,
    path: workspacePath(value),
    remote: workspaceRemote(value),
    branch: workspaceBranch(value),
    isolation: workspaceIsolation(value),
    archived: value?.archived === true || String(value?.status || '').toLowerCase() === 'archived',
    pathKey: normalizedPath(workspacePath(value), platform),
    remoteIdentity: remoteIdentity(workspaceRemote(value)),
  };
}

function exactWorkspaceMatches(workspaces, checkout, repositoryRemote, platform = process.platform) {
  const targetPath = normalizedPath(checkout, platform);
  const targetRemote = remoteIdentity(repositoryRemote);
  return workspaces.filter((workspace) => {
    if (workspace.archived) return false;
    const pathMatch = workspace.pathKey && workspace.pathKey === targetPath;
    const remoteMatch = targetRemote && workspace.remoteIdentity === targetRemote;
    return pathMatch || remoteMatch;
  });
}

function safeCommand(context, args) {
  const result = context.command(args, { allowFailure: true });
  return result && typeof result === 'object' ? result : { ok: false, stdout: '', stderr: 'Invalid Paseo command response.' };
}

export function listPaseoWorkspaces(context, { platform = process.platform } = {}) {
  const result = safeCommand(context, ['workspace', 'ls', '--json']);
  if (!result.ok) {
    return {
      ok: false,
      workspaces: [],
      blocker: {
        code: 'paseo-workspace-list-failed',
        message: 'Paseo workspaces could not be listed.',
        recoveryAction: 'Verify the Paseo connection and try again.',
      },
      diagnostic: result,
    };
  }
  const parsed = parseJson(result.stdout);
  if (parsed === null) {
    return {
      ok: false,
      workspaces: [],
      blocker: {
        code: 'paseo-workspace-response-invalid',
        message: 'Paseo returned an unreadable workspace list.',
        recoveryAction: 'Update Paseo or inspect the technical details before continuing.',
      },
      diagnostic: result,
    };
  }
  const workspaces = workspaceRows(parsed)
    .map((value) => normalizeWorkspace(value, platform))
    .filter((workspace) => workspace.id && workspace.path);
  return { ok: true, workspaces, blocker: null, diagnostic: null };
}

export function findMatchingPaseoWorkspace(context, {
  checkout,
  repositoryRemote = null,
  baseBranch,
  platform = process.platform,
} = {}) {
  const listed = listPaseoWorkspaces(context, { platform });
  if (!listed.ok) return listed;
  const matches = exactWorkspaceMatches(listed.workspaces, checkout, repositoryRemote, platform);
  if (matches.length > 1) {
    return {
      ok: false,
      workspaces: listed.workspaces,
      matches,
      blocker: {
        code: 'paseo-workspace-ambiguous',
        message: 'More than one active Paseo workspace matches this repository checkout.',
        recoveryAction: 'Archive or disambiguate duplicate Paseo workspaces, then recheck.',
      },
    };
  }
  if (matches.length === 1) {
    const workspace = matches[0];
    const mismatch = workspace.pathKey !== normalizedPath(checkout, platform)
      || (repositoryRemote && workspace.remoteIdentity && workspace.remoteIdentity !== remoteIdentity(repositoryRemote));
    if (mismatch) {
      return {
        ok: false,
        workspaces: listed.workspaces,
        matches,
        blocker: {
          code: 'paseo-workspace-identity-mismatch',
          message: 'A Paseo workspace matches only part of the selected repository identity.',
          recoveryAction: 'Choose the correct checkout or archive the mismatched workspace, then recheck.',
        },
      };
    }
    return {
      ok: true,
      found: true,
      workspace,
      workspaces: listed.workspaces,
      baseBranchVerified: !workspace.branch || workspace.branch === String(baseBranch),
      blocker: workspace.branch && workspace.branch !== String(baseBranch)
        ? {
          code: 'paseo-workspace-base-branch-mismatch',
          message: `The Paseo workspace is associated with ${workspace.branch}, not ${baseBranch}.`,
          recoveryAction: 'Select the matching base branch or create a new workspace.',
        }
        : null,
    };
  }
  return { ok: true, found: false, workspace: null, workspaces: listed.workspaces, blocker: null };
}

function createdWorkspaceFromResult(result, platform = process.platform) {
  const parsed = parseJson(result?.stdout);
  const candidates = workspaceRows(parsed);
  const row = candidates[0] || parsed;
  const workspace = row && typeof row === 'object' ? normalizeWorkspace(row, platform) : null;
  return workspace?.id ? workspace : null;
}

export function createPermanentPaseoWorkspace(context, {
  checkout,
  title = 'Issue Coding Automation',
  platform = process.platform,
} = {}) {
  const result = safeCommand(context, [
    'workspace', 'create',
    '--isolation', 'local',
    '--path', path.resolve(checkout),
    '--title', String(title),
    '--json',
  ]);
  if (!result.ok) {
    return {
      ok: false,
      workspace: null,
      blocker: {
        code: 'paseo-workspace-create-failed',
        message: 'Paseo could not create the permanent automation workspace.',
        recoveryAction: 'Inspect the Paseo workspace error and try again.',
      },
      diagnostic: result,
    };
  }
  const workspace = createdWorkspaceFromResult(result, platform);
  if (!workspace) {
    return {
      ok: false,
      workspace: null,
      blocker: {
        code: 'paseo-workspace-create-unverified',
        message: 'Paseo reported workspace creation success but did not return a verifiable workspace identity.',
        recoveryAction: 'Recheck Paseo workspaces before continuing.',
      },
      diagnostic: result,
    };
  }
  return { ok: true, workspace, blocker: null };
}

export function ensurePermanentPaseoWorkspace(context, options = {}) {
  const existing = findMatchingPaseoWorkspace(context, options);
  if (!existing.ok || existing.blocker) return existing;
  if (existing.found) return { ...existing, reused: true, created: false };

  const created = createPermanentPaseoWorkspace(context, options);
  if (!created.ok) return created;
  const verified = findMatchingPaseoWorkspace(context, options);
  if (!verified.ok || verified.blocker || !verified.found) {
    return {
      ok: false,
      workspace: created.workspace,
      created: true,
      reused: false,
      blocker: verified.blocker || {
        code: 'paseo-workspace-verification-failed',
        message: 'The newly created Paseo workspace could not be verified against the selected checkout.',
        recoveryAction: 'Recheck Paseo workspaces and resolve the mismatch before continuing.',
      },
    };
  }
  return { ...verified, reused: false, created: true };
}

function uniqueProbeName(prefix = 'paseo-readiness') {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return `${prefix}-${suffix}`;
}

function branchExists(checkout, branch, runner) {
  const result = runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: checkout, allowFailure: true });
  return result?.ok === true;
}

function gitWorktreePaths(checkout, runner, platform = process.platform) {
  const result = runner('git', ['worktree', 'list', '--porcelain'], { cwd: checkout, allowFailure: true });
  if (!result?.ok) return null;
  return String(result.stdout || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => normalizedPath(line.slice('worktree '.length), platform));
}

function archiveProbe(context, workspaceId) {
  return safeCommand(context, ['workspace', 'archive', String(workspaceId), '--json']);
}

export function probePaseoWorktreeReadiness(context, {
  checkout,
  baseBranch,
  runner,
  platform = process.platform,
} = {}) {
  if (typeof runner !== 'function') throw new Error('A Git runner is required for safe readiness verification.');
  const branch = uniqueProbeName();
  const slug = uniqueProbeName('readiness');
  const beforeWorktrees = gitWorktreePaths(checkout, runner, platform);
  if (!beforeWorktrees) {
    return {
      ok: false,
      blocker: {
        code: 'paseo-readiness-git-inspection-failed',
        message: 'Git worktrees could not be inspected safely before the readiness probe.',
        recoveryAction: 'Resolve the Git worktree inspection error before continuing.',
      },
    };
  }
  if (branchExists(checkout, branch, runner)) {
    return {
      ok: false,
      blocker: {
        code: 'paseo-readiness-branch-collision',
        message: 'The temporary readiness branch already exists.',
        recoveryAction: 'Recheck readiness to generate another isolated probe.',
      },
    };
  }

  const create = safeCommand(context, [
    'workspace', 'create',
    '--isolation', 'worktree',
    '--path', path.resolve(checkout),
    '--mode', 'branch-off',
    '--new-branch', branch,
    '--worktree-slug', slug,
    '--base', String(baseBranch),
    '--json',
  ]);
  if (!create.ok) {
    return {
      ok: false,
      branch,
      workspace: null,
      blocker: {
        code: 'paseo-readiness-worktree-create-failed',
        message: 'Paseo could not create the temporary readiness worktree.',
        recoveryAction: 'Inspect setup-hook or worktree errors, then retry readiness.',
      },
      diagnostic: create,
    };
  }

  const workspace = createdWorkspaceFromResult(create, platform);
  if (!workspace?.id) {
    return {
      ok: false,
      branch,
      workspace: null,
      blocker: {
        code: 'paseo-readiness-workspace-unverified',
        message: 'Paseo created a worktree but did not return a verifiable workspace ID.',
        recoveryAction: 'Do not remove anything manually; inspect Paseo workspaces and resolve the unknown probe workspace.',
      },
    };
  }

  const duringWorktrees = gitWorktreePaths(checkout, runner, platform);
  const createdPath = workspace.path ? normalizedPath(workspace.path, platform) : null;
  const worktreeWasAdded = Boolean(createdPath && duringWorktrees?.includes(createdPath) && !beforeWorktrees.includes(createdPath));
  if (!worktreeWasAdded) {
    return {
      ok: false,
      branch,
      workspace,
      blocker: {
        code: 'paseo-readiness-worktree-unverified',
        message: 'The temporary Paseo worktree could not be verified in Git worktree state.',
        recoveryAction: 'Preserve the probe workspace and inspect its path before taking cleanup action.',
      },
    };
  }

  const archive = archiveProbe(context, workspace.id);
  if (!archive.ok) {
    return {
      ok: false,
      branch,
      workspace,
      blocker: {
        code: 'paseo-readiness-cleanup-failed',
        message: 'The readiness workspace was created but Paseo could not archive it safely.',
        recoveryAction: 'Resolve or archive the visible readiness workspace in Paseo before continuing.',
      },
      diagnostic: archive,
    };
  }

  const afterWorktrees = gitWorktreePaths(checkout, runner, platform);
  const pathRemoved = Boolean(afterWorktrees && !afterWorktrees.includes(createdPath));
  const branchRemoved = !branchExists(checkout, branch, runner);
  const directoryRemoved = !workspace.path || !existsSync(workspace.path);
  if (!pathRemoved || !branchRemoved || !directoryRemoved) {
    return {
      ok: false,
      branch,
      workspace,
      cleanup: { pathRemoved, branchRemoved, directoryRemoved },
      blocker: {
        code: 'paseo-readiness-cleanup-unverified',
        message: 'Paseo archived the readiness workspace, but complete worktree cleanup could not be verified.',
        recoveryAction: 'Inspect the visible leftover branch/worktree before continuing. Do not delete it automatically.',
      },
    };
  }

  return {
    ok: true,
    workspace,
    branch,
    paidModelRequestSent: false,
    cleanup: { pathRemoved: true, branchRemoved: true, directoryRemoved: true },
    blocker: null,
  };
}

export function ensurePaseoWorkspaceReadiness(context, {
  checkout,
  repositoryRemote = null,
  baseBranch,
  runner,
  platform = process.platform,
  title = 'Issue Coding Automation',
} = {}) {
  const workspace = ensurePermanentPaseoWorkspace(context, {
    checkout,
    repositoryRemote,
    baseBranch,
    platform,
    title,
  });
  if (!workspace.ok || workspace.blocker) return { ok: false, workspace, readiness: null, blocker: workspace.blocker };
  const readiness = probePaseoWorktreeReadiness(context, { checkout, baseBranch, runner, platform });
  if (!readiness.ok) return { ok: false, workspace, readiness, blocker: readiness.blocker };
  return { ok: true, workspace, readiness, blocker: null };
}
