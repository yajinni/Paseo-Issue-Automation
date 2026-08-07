import {
  addGitHubAccount,
  githubAccountServiceStatus,
  reauthenticateGitHubAccount,
  reconcileRepositorySelection,
  setupGitCredentialHelper,
  switchGitHubAccount,
} from './github-accounts.mjs';
import {
  listAllGitHubRepositories,
  listGitHubBranchPage,
} from './github-repositories.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

function activeSession(options) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function selections(session) {
  const value = session.pages?.repository?.selections || {};
  return {
    host: String(value.host || 'github.com').trim() || 'github.com',
    account: String(value.account || '').trim(),
    repository: String(value.repository || '').trim(),
    baseBranch: String(value.baseBranch || '').trim(),
  };
}

function collectBranches(repository, options = {}) {
  const branches = [];
  let after = null;
  for (let page = 0; page < 100; page += 1) {
    const result = listGitHubBranchPage(repository, { ...options, after });
    if (!result.ok) return { ...result, branches };
    branches.push(...result.branches);
    if (!result.pageInfo.hasNextPage) return { ...result, branches };
    if (!result.pageInfo.endCursor || result.pageInfo.endCursor === after) {
      return {
        ok: false,
        repository: typeof repository === 'string' ? repository : repository?.nameWithOwner,
        branches,
        recommended: result.recommended,
        blocker: {
          code: 'github-branch-pagination-stalled',
          message: 'GitHub branch pagination did not advance.',
          recoveryAction: 'Refresh branches.',
        },
      };
    }
    after = result.pageInfo.endCursor;
  }
  return {
    ok: false,
    repository: typeof repository === 'string' ? repository : repository?.nameWithOwner,
    branches,
    recommended: null,
    blocker: {
      code: 'github-branch-pagination-limit',
      message: 'Branch discovery exceeded its safety page limit.',
      recoveryAction: 'Refresh branches.',
    },
  };
}

function blocker(code, message, recoveryAction) {
  return { code, message, recoveryAction };
}

function validate({ cli, auth, repositories, branchResult, selection }) {
  const blockers = [];
  if (!cli?.installed) blockers.push(blocker(
    'github-cli-required',
    'GitHub CLI is required before repository setup can continue.',
    'Install GitHub CLI and recheck this page.',
  ));
  if (!auth?.ok || !auth.activeAccount) blockers.push(blocker(
    'github-account-required',
    'Choose or add an authenticated GitHub account.',
    'Authenticate with GitHub CLI, then recheck this page.',
  ));
  if (auth?.activeAccount && selection.account && auth.activeAccount.login !== selection.account) blockers.push(blocker(
    'github-account-changed',
    'The active GitHub account changed after this page was configured.',
    'Switch back to the selected account or choose a repository for the active account.',
  ));
  const repository = repositories?.find((item) => item.nameWithOwner === selection.repository) || null;
  if (!repository) blockers.push(blocker(
    'github-repository-required',
    selection.repository ? 'The selected repository is no longer visible to the active GitHub account.' : 'Choose a GitHub repository.',
    'Refresh repositories and choose an accessible repository.',
  ));
  else if (!repository.selectable) blockers.push(blocker(
    'github-repository-not-automatable',
    repository.disabledReasons?.[0]?.message || 'The selected repository does not provide all required permissions.',
    'Choose a repository with the required read, write, issues, and label permissions.',
  ));
  if (repository && repository.selectable) {
    const branch = branchResult?.branches?.find((item) => item.name === selection.baseBranch);
    if (!branch) blockers.push(blocker(
      'github-base-branch-required',
      selection.baseBranch ? 'The selected base branch is no longer available.' : 'Choose a base branch.',
      'Refresh branches and choose an available base branch.',
    ));
  }
  return { ok: blockers.length === 0, blockers, repository };
}

function technicalDetails(status) {
  return {
    cli: {
      installed: status.cli?.installed === true,
      path: status.cli?.path || null,
      version: status.cli?.version || null,
    },
    activeAccount: status.auth?.activeAccount ? {
      host: status.auth.activeAccount.host,
      login: status.auth.activeAccount.login,
    } : null,
    repositoryCount: status.repositories?.length || 0,
    branchCount: status.branches?.length || 0,
    catalogBlocker: status.catalogBlocker || null,
    branchBlocker: status.branchBlocker || null,
  };
}

function publicResponse(status, session) {
  const selection = selections(session);
  const validation = validate({
    cli: status.cli,
    auth: status.auth,
    repositories: status.repositories,
    branchResult: { branches: status.branches },
    selection,
  });
  return {
    cli: status.cli,
    auth: status.auth,
    repositories: status.repositories,
    branches: status.branches,
    recommendedBranch: status.recommendedBranch,
    selection,
    check: session.pages?.repository?.lastCheck || {
      ok: validation.ok,
      summary: validation.ok ? 'GitHub account, repository, and base branch are ready.' : validation.blockers[0]?.message || 'GitHub setup needs attention.',
      blockers: validation.blockers,
    },
    catalogBlocker: status.catalogBlocker || null,
    branchBlocker: status.branchBlocker || null,
    technicalDetails: technicalDetails(status),
  };
}

function loadStatus(options = {}) {
  const session = activeSession(options);
  const selection = selections(session);
  const accountStatus = (options.accountStatus || githubAccountServiceStatus)(options);
  const auth = accountStatus.auth || { ok: false, accounts: [], activeAccount: null, hosts: [] };
  let repositories = [];
  let catalogBlocker = null;
  let branches = [];
  let recommendedBranch = null;
  let branchBlocker = null;

  if (accountStatus.cli?.installed && auth.ok && auth.activeAccount) {
    const catalog = (options.repositoryLoader || listAllGitHubRepositories)({
      host: auth.activeAccount.host || selection.host,
      runner: options.runner,
      env: options.env,
    });
    repositories = catalog.repositories || [];
    catalogBlocker = catalog.ok ? null : catalog.blocker;
    const reconciled = reconcileRepositorySelection(selection.repository || null, repositories);
    const repositoryName = reconciled.selection ? selection.repository : '';
    if (repositoryName) {
      const result = (options.branchLoader || collectBranches)(repositoryName, {
        host: auth.activeAccount.host || selection.host,
        runner: options.runner,
        env: options.env,
      });
      branches = result.branches || [];
      recommendedBranch = result.recommended || null;
      branchBlocker = result.ok ? null : result.blocker;
    }
  }

  return {
    session,
    cli: accountStatus.cli,
    auth,
    repositories,
    catalogBlocker,
    branches,
    recommendedBranch,
    branchBlocker,
  };
}

function preserveSelection(status) {
  const prior = selections(status.session);
  const active = status.auth?.activeAccount;
  if (!active) return { ...prior, account: '', repository: '', baseBranch: '' };
  if (prior.account && prior.account !== active.login) {
    return { host: active.host || 'github.com', account: active.login, repository: '', baseBranch: '' };
  }
  const reconciled = reconcileRepositorySelection(prior.repository || null, status.repositories);
  const repository = reconciled.selection ? prior.repository : '';
  const branch = repository && status.branches.some((item) => item.name === prior.baseBranch)
    ? prior.baseBranch
    : '';
  return {
    host: active.host || prior.host || 'github.com',
    account: active.login,
    repository,
    baseBranch: branch,
  };
}

export function getGitHubSetupPageStatus(options = {}) {
  let status = loadStatus(options);
  const prior = selections(status.session);
  const preserved = preserveSelection(status);
  if (JSON.stringify(prior) !== JSON.stringify(preserved)) {
    const session = saveSetupPage('repository', { selections: preserved }, options);
    status = { ...status, session };
  }
  return publicResponse(status, status.session);
}

export function saveGitHubSetupPage(input = {}, options = {}) {
  let status = loadStatus(options);
  const prior = selections(status.session);
  const active = status.auth?.activeAccount;
  const repositoryName = String(input.repository ?? prior.repository).trim();
  const repositoryChanged = repositoryName !== prior.repository;
  const selectedRepository = status.repositories.find((item) => item.nameWithOwner === repositoryName) || null;
  let baseBranch = repositoryChanged ? '' : String(input.baseBranch ?? prior.baseBranch).trim();
  if (repositoryChanged && selectedRepository) baseBranch = selectedRepository.defaultBranch || '';
  if (Object.hasOwn(input, 'baseBranch')) baseBranch = String(input.baseBranch || '').trim();
  const next = {
    host: active?.host || prior.host || 'github.com',
    account: active?.login || '',
    repository: repositoryName,
    baseBranch,
  };
  let session = saveSetupPage('repository', { selections: next }, options);

  if (repositoryName && selectedRepository?.selectable && (!status.branches.length || repositoryChanged)) {
    const branchResult = (options.branchLoader || collectBranches)(repositoryName, {
      host: active?.host || next.host,
      runner: options.runner,
      env: options.env,
    });
    status = {
      ...status,
      branches: branchResult.branches || [],
      recommendedBranch: branchResult.recommended || null,
      branchBlocker: branchResult.ok ? null : branchResult.blocker,
    };
    if (!baseBranch && branchResult.recommended) {
      baseBranch = branchResult.recommended;
      session = saveSetupPage('repository', { selections: { baseBranch } }, options);
    }
  }

  const selection = selections(session);
  const validation = validate({ cli: status.cli, auth: status.auth, repositories: status.repositories, branchResult: { branches: status.branches }, selection });
  if (validation.ok) {
    session = saveSetupPage('repository', {
      repository: {
        owner: validation.repository.owner,
        name: validation.repository.name,
        id: validation.repository.id,
        url: validation.repository.url,
      },
      baseBranch: selection.baseBranch,
    }, options);
  }
  session = recordSetupPageCheck('repository', {
    ok: validation.ok,
    summary: validation.ok ? 'GitHub account, repository, and base branch are ready.' : validation.blockers[0]?.message || 'GitHub setup needs attention.',
    blockers: validation.blockers,
  }, options);
  status = { ...status, session };
  return publicResponse(status, session);
}

export function recheckGitHubSetupPage(options = {}) {
  let status = loadStatus(options);
  const preserved = preserveSelection(status);
  let session = saveSetupPage('repository', { selections: preserved }, options);
  const validation = validate({ cli: status.cli, auth: status.auth, repositories: status.repositories, branchResult: { branches: status.branches }, selection: preserved });
  session = recordSetupPageCheck('repository', {
    ok: validation.ok,
    summary: validation.ok ? 'GitHub account, repository, and base branch are ready.' : validation.blockers[0]?.message || 'GitHub setup needs attention.',
    blockers: validation.blockers,
  }, options);
  status = { ...status, session };
  return publicResponse(status, session);
}

export function runGitHubSetupAccountAction(input = {}, options = {}) {
  const action = String(input.action || '').trim();
  const host = String(input.host || 'github.com').trim() || 'github.com';
  const runnerOptions = { runner: options.runner, env: options.env, host };
  let result;
  if (action === 'add') result = (options.addAccount || addGitHubAccount)(runnerOptions);
  else if (action === 'switch') result = (options.switchAccount || switchGitHubAccount)({ ...runnerOptions, user: input.user });
  else if (action === 'reauthenticate') result = (options.reauthenticate || reauthenticateGitHubAccount)(runnerOptions);
  else if (action === 'setup-git') result = (options.setupGit || setupGitCredentialHelper)(runnerOptions);
  else throw new Error('Unsupported GitHub account action.');
  return { action, result, status: getGitHubSetupPageStatus(options) };
}
