import {
  recheckGitHubSetupPage,
  runGitHubSetupAccountAction,
  saveGitHubSetupPage,
} from './github-page-service.mjs';
import { createPaseoConnectionContext } from './paseo-connection.mjs';
import {
  ensurePaseoProjectWorkspace,
  PERMANENT_PASEO_WORKSPACE_NAME,
} from './repository-paseo-service.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'github-setup-request-failed', message: String(error?.message || error || 'GitHub setup request failed.') } }, status);
}

function activeSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function repositoryKey(session) {
  return session.repository ? `${session.repository.owner}/${session.repository.name}` : '';
}

function paseoSelections(session) {
  const selections = session.pages?.repository?.selections || {};
  const currentRepository = repositoryKey(session);
  const currentBranch = String(session.baseBranch || '');
  const matches = selections.paseoRepository === currentRepository
    && selections.paseoBaseBranch === currentBranch;
  return {
    ready: Boolean(matches && selections.checkoutPath && selections.paseoProjectName && selections.paseoWorkspaceId),
    projectName: matches ? String(selections.paseoProjectName || '') : '',
    workspaceId: matches ? String(selections.paseoWorkspaceId || '') : '',
    workspaceName: matches ? String(selections.paseoWorkspaceName || '') : '',
    checkoutPath: matches ? String(selections.checkoutPath || '') : '',
  };
}

async function paseoContext(session, options = {}) {
  const host = String(session.pages?.paseo?.selections?.host || '').trim();
  if (!host) throw new Error('The verified Paseo host is missing. Recheck the Paseo page first.');
  let stored = null;
  if (options.credentialStore) {
    try { stored = await options.credentialStore.read(host); } catch { stored = null; }
  }
  const contextFactory = options.contextFactory || createPaseoConnectionContext;
  return contextFactory({
    host,
    password: stored?.password || null,
    cwd: options.cwd,
    env: options.env,
    run: options.runner,
    runJson: options.runJson,
  });
}

function publicPaseoStatus(session, blocker = null, extra = {}) {
  const saved = paseoSelections(session);
  return {
    ready: saved.ready && !blocker,
    projectName: saved.projectName || null,
    workspaceId: saved.workspaceId || null,
    workspaceName: saved.workspaceName || PERMANENT_PASEO_WORKSPACE_NAME,
    checkoutPath: saved.checkoutPath || null,
    permanentWorkspaceName: PERMANENT_PASEO_WORKSPACE_NAME,
    blocker,
    ...extra,
  };
}

function commitValidatedRepositoryIdentity(status, options = {}) {
  let session = activeSession(options);
  if (session.repository && session.baseBranch) return session;
  const selection = status?.selection || session.pages?.repository?.selections || {};
  const selected = (status?.repositories || []).find((repository) => repository.nameWithOwner === selection.repository) || null;
  if (!selected || !selection.baseBranch) return session;
  session = saveSetupPage('repository', {
    repository: {
      owner: selected.owner,
      name: selected.name,
      id: selected.id,
      url: selected.url,
    },
    baseBranch: selection.baseBranch,
  }, options);
  return session;
}

async function ensureRepositoryPaseo(options = {}) {
  let session = activeSession(options);
  if (!session.repository || !session.baseBranch) {
    const blocker = {
      code: 'github-repository-required',
      message: 'Choose a GitHub repository and base branch before Paseo setup.',
      recoveryAction: 'Choose the repository and base branch.',
    };
    return publicPaseoStatus(session, blocker);
  }

  const context = await paseoContext(session, options);
  const result = (options.ensurePaseoProjectWorkspace || ensurePaseoProjectWorkspace)(context, {
    nameWithOwner: repositoryKey(session),
  }, {
    rootDir: options.rootDir,
    runner: options.runner,
    managedRoot: options.managedRoot,
  });

  if (!result.ok) {
    session = recordSetupPageCheck('repository', {
      ok: false,
      summary: result.blocker?.message || 'Paseo project setup needs attention.',
      blockers: [result.blocker || {
        code: 'paseo-project-setup-failed',
        message: 'Paseo project setup did not complete.',
        recoveryAction: 'Retry repository setup.',
      }],
    }, options);
    return publicPaseoStatus(session, result.blocker, {
      diagnostic: result.diagnostic || null,
    });
  }

  session = saveSetupPage('repository', {
    selections: {
      paseoRepository: repositoryKey(session),
      paseoBaseBranch: String(session.baseBranch),
      checkoutPath: result.project.checkoutPath,
      paseoProjectName: result.project.name,
      paseoWorkspaceId: result.workspace.id,
      paseoWorkspaceName: result.workspace.name,
    },
    managedCheckout: {
      path: result.project.checkoutPath,
      managed: result.createdProject === true,
      workspaceId: result.workspace.id,
    },
  }, options);
  session = recordSetupPageCheck('repository', {
    ok: true,
    summary: `GitHub repository, Paseo project, and “${PERMANENT_PASEO_WORKSPACE_NAME}” workspace are ready.`,
    blockers: [],
  }, options);
  return publicPaseoStatus(session, null, {
    createdProject: result.createdProject === true,
    createdWorkspace: result.createdWorkspace === true,
  });
}

async function decorateGitHubStatus(status, options = {}) {
  if (!status?.check?.ok) {
    return { ...status, githubReady: false, paseoReady: false, paseo: publicPaseoStatus(activeSession(options)) };
  }
  commitValidatedRepositoryIdentity(status, options);
  const paseo = await ensureRepositoryPaseo(options);
  const session = activeSession(options);
  const check = session.pages?.repository?.lastCheck || status.check;
  return {
    ...status,
    selection: session.pages?.repository?.selections || status.selection,
    check,
    githubReady: true,
    paseoReady: paseo.ready === true,
    paseo,
  };
}

export async function githubSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/github')) return { handled: false };
  try {
    if (pathname === '/api/setup/github/paseo-status' && method === 'GET') {
      const session = activeSession(options);
      return response(publicPaseoStatus(session, session.pages?.repository?.lastCheck?.ok === false
        ? session.pages.repository.lastCheck.blockers?.[0] || null
        : null));
    }
    if (pathname === '/api/setup/github/status' && method === 'GET') {
      return response(await decorateGitHubStatus(recheckGitHubSetupPage(options), options));
    }
    if (pathname === '/api/setup/github/save' && method === 'POST') {
      return response(await decorateGitHubStatus(saveGitHubSetupPage(body, options), options));
    }
    if (pathname === '/api/setup/github/recheck' && method === 'POST') {
      return response(await decorateGitHubStatus(recheckGitHubSetupPage(options), options));
    }
    if (pathname === '/api/setup/github/account' && method === 'POST') {
      const result = runGitHubSetupAccountAction(body, options);
      result.status = await decorateGitHubStatus(result.status, options);
      return response(result);
    }
    return response({ error: { code: 'github-setup-route-unavailable', message: `GitHub setup route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
