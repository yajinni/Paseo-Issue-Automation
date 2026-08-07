import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { addRepository, listRepositories, managerHome } from '../repository-registry.mjs';
import { run as defaultRun } from '../process.mjs';
import { normalizeGitRemote } from './repository-checkouts.mjs';

export const PERMANENT_PASEO_WORKSPACE_NAME = 'Issue Coding Automation';

function repositoryName(repository) {
  const value = typeof repository === 'string'
    ? repository
    : repository?.nameWithOwner || repository?.repository || '';
  const [owner, name, ...extra] = String(value).trim().split('/');
  if (!owner || !name || extra.length) throw new Error('Repository must use owner/name form.');
  return `${owner}/${name}`;
}

function repositoryIdentity(repository) {
  const name = repositoryName(repository);
  return normalizeGitRemote(`https://github.com/${name}.git`)?.identity || null;
}

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); }
  catch { return null; }
}

function collectObjects(value) {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (!value || typeof value !== 'object') return [];
  const rows = [];
  if ((value.workspaceId || value.id) && (value.cwd || value.workspaceDirectory || value.path || value.directory)) {
    rows.push(value);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') rows.push(...collectObjects(child));
  }
  return rows;
}

function normalizeWorkspace(row) {
  const cwd = String(row?.cwd || row?.workspaceDirectory || row?.path || row?.directory || '').trim();
  return {
    id: String(row?.workspaceId || row?.id || '').trim() || null,
    projectName: String(row?.project || row?.projectDisplayName || row?.projectName || '').trim() || null,
    name: String(row?.name || row?.title || '').trim() || null,
    isolation: String(row?.isolation || row?.workspaceKind || row?.kind || '').trim().toLowerCase() || null,
    cwd: cwd ? path.resolve(cwd) : null,
  };
}

export function listPaseoRepositoryWorkspaces(context) {
  const result = context.command(['workspace', 'ls', '--json'], { allowFailure: true });
  if (!result?.ok) {
    return {
      ok: false,
      rows: [],
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
      rows: [],
      blocker: {
        code: 'paseo-workspace-response-invalid',
        message: 'Paseo returned an unreadable workspace list.',
        recoveryAction: 'Update Paseo or inspect the technical details, then try again.',
      },
      diagnostic: result,
    };
  }
  const seen = new Set();
  const rows = collectObjects(parsed)
    .map(normalizeWorkspace)
    .filter((row) => row.id && row.cwd)
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  return { ok: true, rows, blocker: null, diagnostic: null };
}

function remoteIdentityAt(directory, runner) {
  if (!directory) return null;
  const result = runner('git', ['remote', 'get-url', 'origin'], { cwd: directory, allowFailure: true });
  if (!result?.ok) return null;
  return normalizeGitRemote(result.stdout)?.identity || null;
}

function workspaceMatchesRepository(workspace, repository, runner) {
  return Boolean(workspace?.cwd && remoteIdentityAt(workspace.cwd, runner) === repositoryIdentity(repository));
}

function registeredCheckout(repository, { rootDir, runner }) {
  const target = repositoryIdentity(repository);
  for (const entry of listRepositories({ rootDir })) {
    const identity = normalizeGitRemote(entry.remote)?.identity
      || (entry.repository ? repositoryIdentity(entry.repository) : null);
    if (identity !== target) continue;
    if (remoteIdentityAt(entry.path, runner) === target) return path.resolve(entry.path);
  }
  return null;
}

function sourceCheckoutFromWorkspace(workspace, runner) {
  if (!workspace?.cwd) return null;
  if (workspace.isolation !== 'worktree') return workspace.cwd;
  const result = runner('git', ['worktree', 'list', '--porcelain'], { cwd: workspace.cwd, allowFailure: true });
  if (!result?.ok) return null;
  const first = String(result.stdout || '').split(/\r?\n/).find((line) => line.startsWith('worktree '));
  return first ? path.resolve(first.slice('worktree '.length)) : null;
}

function findClonePayload(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && value.checkoutPath) return value;
  for (const child of Object.values(value)) {
    const found = findClonePayload(child);
    if (found) return found;
  }
  return null;
}

function clonePaseoProject(context, repository, { managedRoot }) {
  mkdirSync(managedRoot, { recursive: true });
  const result = context.command([
    'clone', repositoryName(repository),
    '--dir', managedRoot,
    '--protocol', 'https',
    '--json',
  ], { allowFailure: true });
  if (!result?.ok) {
    return {
      ok: false,
      blocker: {
        code: 'paseo-project-clone-failed',
        message: 'Paseo could not create a project for this GitHub repository.',
        recoveryAction: 'Check the Paseo/GitHub clone error and retry.',
      },
      diagnostic: result,
    };
  }
  const payload = findClonePayload(parseJson(result.stdout));
  const checkoutPath = String(payload?.checkoutPath || '').trim();
  if (!checkoutPath) {
    return {
      ok: false,
      blocker: {
        code: 'paseo-project-clone-unverified',
        message: 'Paseo reported clone success but did not return the project checkout path.',
        recoveryAction: 'Refresh Paseo and retry repository setup.',
      },
      diagnostic: result,
    };
  }
  return {
    ok: true,
    checkoutPath: path.resolve(checkoutPath),
    projectId: payload?.projectId ? String(payload.projectId) : null,
    projectName: payload?.projectName ? String(payload.projectName) : null,
    diagnostic: null,
  };
}

function registerManagerCheckout(checkoutPath, { rootDir, runner }) {
  try {
    return { ok: true, repository: addRepository(checkoutPath, { rootDir, runner }), blocker: null };
  } catch (error) {
    return {
      ok: false,
      repository: null,
      blocker: {
        code: 'manager-repository-registration-failed',
        message: 'The Paseo project exists, but its checkout could not be registered with the automation manager.',
        recoveryAction: String(error?.message || error || 'Retry repository setup.'),
      },
    };
  }
}

export function ensurePaseoProjectWorkspace(context, repository, {
  rootDir,
  runner = defaultRun,
  permanentWorkspaceName = PERMANENT_PASEO_WORKSPACE_NAME,
  managedRoot = path.join(rootDir || managerHome(), 'managed-repositories'),
} = {}) {
  const listed = listPaseoRepositoryWorkspaces(context);
  if (!listed.ok) return { ok: false, project: null, workspace: null, blocker: listed.blocker, diagnostic: listed.diagnostic };

  let matching = listed.rows.filter((row) => workspaceMatchesRepository(row, repository, runner));
  let permanent = matching.find((row) => row.name === permanentWorkspaceName && row.isolation !== 'worktree') || null;
  let checkoutPath = permanent?.cwd
    || matching.map((row) => sourceCheckoutFromWorkspace(row, runner)).find(Boolean)
    || registeredCheckout(repository, { rootDir, runner });
  let projectName = permanent?.projectName || matching.find((row) => row.projectName)?.projectName || null;
  let projectId = null;
  let createdProject = false;

  if (!checkoutPath) {
    const cloned = clonePaseoProject(context, repository, { managedRoot });
    if (!cloned.ok) return { ok: false, project: null, workspace: null, blocker: cloned.blocker, diagnostic: cloned.diagnostic };
    checkoutPath = cloned.checkoutPath;
    projectName = cloned.projectName;
    projectId = cloned.projectId;
    createdProject = true;
  }

  const registration = registerManagerCheckout(checkoutPath, { rootDir, runner });
  if (!registration.ok) return { ok: false, project: null, workspace: permanent, blocker: registration.blocker, diagnostic: null };

  if (!permanent) {
    const created = context.command([
      'workspace', 'create',
      '--isolation', 'local',
      '--path', checkoutPath,
      '--title', permanentWorkspaceName,
      '--json',
    ], { allowFailure: true });
    if (!created?.ok) {
      return {
        ok: false,
        project: { id: projectId, name: projectName, checkoutPath },
        workspace: null,
        blocker: {
          code: 'paseo-permanent-workspace-create-failed',
          message: `Paseo could not create the permanent workspace “${permanentWorkspaceName}”.`,
          recoveryAction: 'Inspect the Paseo workspace error and retry.',
        },
        diagnostic: created,
      };
    }
  }

  const verified = listPaseoRepositoryWorkspaces(context);
  if (!verified.ok) return { ok: false, project: null, workspace: null, blocker: verified.blocker, diagnostic: verified.diagnostic };
  matching = verified.rows.filter((row) => workspaceMatchesRepository(row, repository, runner));
  permanent = matching.find((row) => row.name === permanentWorkspaceName && row.isolation !== 'worktree') || null;
  if (!permanent) {
    return {
      ok: false,
      project: { id: projectId, name: projectName, checkoutPath },
      workspace: null,
      blocker: {
        code: 'paseo-permanent-workspace-unverified',
        message: `The permanent Paseo workspace “${permanentWorkspaceName}” could not be verified.`,
        recoveryAction: 'Refresh Paseo workspaces and retry repository setup.',
      },
      diagnostic: null,
    };
  }

  projectName = permanent.projectName || projectName || repositoryName(repository).split('/').at(-1);
  return {
    ok: true,
    project: { id: projectId, name: projectName, checkoutPath },
    workspace: permanent,
    managerRepository: registration.repository,
    createdProject,
    createdWorkspace: !listed.rows.some((row) => row.id === permanent.id),
    blocker: null,
    diagnostic: null,
  };
}
