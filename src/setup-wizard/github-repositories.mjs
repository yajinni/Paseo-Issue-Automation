import { run as defaultRun } from '../process.mjs';

export const GITHUB_REPOSITORY_PAGE_SIZE = 50;
export const GITHUB_BRANCH_PAGE_SIZE = 100;

const REPOSITORY_QUERY = `query($first:Int!,$after:String){
  viewer {
    repositories(
      first:$first,
      after:$after,
      affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],
      orderBy:{field:UPDATED_AT,direction:DESC}
    ) {
      nodes {
        id
        name
        nameWithOwner
        url
        sshUrl
        visibility
        isArchived
        updatedAt
        viewerPermission
        hasIssuesEnabled
        owner { login }
        defaultBranchRef { name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const BRANCH_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name) {
    defaultBranchRef { name }
    refs(
      refPrefix:"refs/heads/",
      first:$first,
      after:$after,
      orderBy:{field:ALPHABETICAL,direction:ASC}
    ) {
      nodes { name target { oid } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); }
  catch { return null; }
}

function textFromFailure(result, parsed = null) {
  const errors = Array.isArray(parsed?.errors)
    ? parsed.errors.map((error) => error?.message).filter(Boolean).join(' ')
    : '';
  return `${errors} ${result?.stderr || ''} ${result?.stdout || ''}`.trim();
}

export function classifyRepositoryCatalogFailure(result, parsed = null) {
  const text = textFromFailure(result, parsed);
  if (/\bSAML\b|single[ -]sign[ -]on|\bSSO\b|organization SAML enforcement/i.test(text)) {
    return {
      code: 'sso-authorization-required',
      message: 'GitHub access is blocked by organization SSO authorization.',
      recoveryAction: 'Authorize the active GitHub CLI account for the organization, then refresh repositories.',
    };
  }
  if (/HTTP\s*401|unauthori[sz]ed|authentication required|bad credentials/i.test(text)) {
    return {
      code: 'github-authentication-required',
      message: 'The active GitHub CLI account is not authenticated for this request.',
      recoveryAction: 'Reauthenticate the selected GitHub account, then refresh repositories.',
    };
  }
  return {
    code: 'github-repository-catalog-unavailable',
    message: 'GitHub repositories could not be loaded.',
    recoveryAction: 'Check GitHub CLI connectivity and account access, then refresh repositories.',
  };
}

function graphql(runner, query, variables, { host = 'github.com', env = process.env } = {}) {
  const args = ['api', 'graphql', '--hostname', String(host), '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables || {})) {
    if (value === null || value === undefined || value === '') continue;
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  const result = runner('gh', args, { allowFailure: true, env });
  const parsed = parseJson(result?.stdout);
  const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  if (!result?.ok || !parsed || errors.length) {
    return { ok: false, data: null, blocker: classifyRepositoryCatalogFailure(result, parsed) };
  }
  return { ok: true, data: parsed.data || null, blocker: null };
}

function permissionCapabilities(permission, hasIssuesEnabled = true) {
  const normalized = String(permission || '').toUpperCase();
  const readable = ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(normalized);
  const writable = ['WRITE', 'MAINTAIN', 'ADMIN'].includes(normalized);
  return {
    read: readable,
    cloneFetch: readable,
    branchPush: writable,
    pullRequestCreate: writable,
    issueRead: readable && hasIssuesEnabled === true,
    issueUpdate: writable && hasIssuesEnabled === true,
    labelManage: writable && hasIssuesEnabled === true,
  };
}

export function normalizeGitHubRepository(repository = {}) {
  const nameWithOwner = String(repository.nameWithOwner || '').trim();
  const permission = String(repository.viewerPermission || '').toUpperCase() || null;
  const defaultBranch = repository.defaultBranchRef?.name ? String(repository.defaultBranchRef.name) : null;
  const hasIssuesEnabled = repository.hasIssuesEnabled !== false;
  const capabilities = permissionCapabilities(permission, hasIssuesEnabled);
  const disabledReasons = [];

  if (repository.isArchived === true) {
    disabledReasons.push({ code: 'repository-archived', message: 'Archived repositories cannot be automated.' });
  }
  if (!defaultBranch) {
    disabledReasons.push({ code: 'repository-empty', message: 'The repository has no default branch yet.' });
  }
  if (!capabilities.read || !capabilities.cloneFetch) {
    disabledReasons.push({ code: 'repository-read-required', message: 'Read and clone/fetch access are required.' });
  }
  if (!capabilities.branchPush || !capabilities.pullRequestCreate) {
    disabledReasons.push({ code: 'repository-write-required', message: 'Write access is required to push automation branches and open pull requests.' });
  }
  if (!hasIssuesEnabled || !capabilities.issueRead || !capabilities.issueUpdate) {
    disabledReasons.push({ code: 'repository-issues-required', message: 'GitHub Issues read/update access is required.' });
  }
  if (!capabilities.labelManage) {
    disabledReasons.push({ code: 'repository-label-management-required', message: 'Permission to manage repository labels is required.' });
  }

  return {
    id: repository.id == null ? null : String(repository.id),
    name: String(repository.name || nameWithOwner.split('/').at(-1) || ''),
    nameWithOwner,
    owner: String(repository.owner?.login || nameWithOwner.split('/')[0] || ''),
    url: repository.url ? String(repository.url) : null,
    sshUrl: repository.sshUrl ? String(repository.sshUrl) : null,
    visibility: repository.visibility ? String(repository.visibility).toUpperCase() : null,
    archived: repository.isArchived === true,
    empty: !defaultBranch,
    defaultBranch,
    updatedAt: repository.updatedAt ? String(repository.updatedAt) : null,
    permission,
    hasIssuesEnabled,
    capabilities,
    selectable: disabledReasons.length === 0,
    disabledReasons,
  };
}

export function listGitHubRepositoryPage({
  host = 'github.com',
  after = null,
  pageSize = GITHUB_REPOSITORY_PAGE_SIZE,
  runner = defaultRun,
  env = process.env,
} = {}) {
  const first = Number(pageSize);
  if (!Number.isInteger(first) || first < 1 || first > 100) throw new Error('Repository page size must be an integer from 1 through 100.');
  const response = graphql(runner, REPOSITORY_QUERY, { first, after }, { host, env });
  if (!response.ok) return { ok: false, repositories: [], pageInfo: { hasNextPage: false, endCursor: null }, blocker: response.blocker };
  const connection = response.data?.viewer?.repositories;
  if (!connection || !Array.isArray(connection.nodes)) {
    return {
      ok: false,
      repositories: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      blocker: { code: 'github-repository-response-invalid', message: 'GitHub returned an invalid repository catalog response.', recoveryAction: 'Refresh repositories.' },
    };
  }
  return {
    ok: true,
    repositories: connection.nodes.map(normalizeGitHubRepository),
    pageInfo: {
      hasNextPage: connection.pageInfo?.hasNextPage === true,
      endCursor: connection.pageInfo?.endCursor || null,
    },
    blocker: null,
  };
}

export function listAllGitHubRepositories({ maxPages = 100, ...options } = {}) {
  const repositories = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = listGitHubRepositoryPage({ ...options, after });
    if (!result.ok) return { ...result, repositories };
    repositories.push(...result.repositories);
    if (!result.pageInfo.hasNextPage) {
      return { ok: true, repositories, pageInfo: result.pageInfo, blocker: null };
    }
    if (!result.pageInfo.endCursor || result.pageInfo.endCursor === after) {
      return {
        ok: false,
        repositories,
        pageInfo: result.pageInfo,
        blocker: { code: 'github-pagination-stalled', message: 'GitHub repository pagination did not advance.', recoveryAction: 'Refresh repositories.' },
      };
    }
    after = result.pageInfo.endCursor;
  }
  return {
    ok: false,
    repositories,
    pageInfo: { hasNextPage: true, endCursor: after },
    blocker: { code: 'github-pagination-limit', message: 'Repository discovery exceeded its safety page limit.', recoveryAction: 'Narrow the account or retry repository discovery.' },
  };
}

function parseRepositoryIdentity(repository) {
  const value = typeof repository === 'string'
    ? repository
    : repository?.nameWithOwner || repository?.fullName || '';
  const [owner, name, ...extra] = String(value).trim().split('/');
  if (!owner || !name || extra.length) throw new Error('Repository must use owner/name form.');
  return { owner, name, nameWithOwner: `${owner}/${name}` };
}

export function listGitHubBranchPage(repository, {
  host = 'github.com',
  after = null,
  pageSize = GITHUB_BRANCH_PAGE_SIZE,
  runner = defaultRun,
  env = process.env,
} = {}) {
  const { owner, name, nameWithOwner } = parseRepositoryIdentity(repository);
  const first = Number(pageSize);
  if (!Number.isInteger(first) || first < 1 || first > 100) throw new Error('Branch page size must be an integer from 1 through 100.');
  const response = graphql(runner, BRANCH_QUERY, { owner, name, first, after }, { host, env });
  if (!response.ok) return { ok: false, repository: nameWithOwner, branches: [], recommended: null, pageInfo: { hasNextPage: false, endCursor: null }, blocker: response.blocker };
  const repo = response.data?.repository;
  const refs = repo?.refs;
  if (!repo || !refs || !Array.isArray(refs.nodes)) {
    return {
      ok: false,
      repository: nameWithOwner,
      branches: [],
      recommended: null,
      pageInfo: { hasNextPage: false, endCursor: null },
      blocker: { code: 'github-branch-response-invalid', message: 'GitHub returned an invalid branch catalog response.', recoveryAction: 'Refresh branches.' },
    };
  }
  const recommended = repo.defaultBranchRef?.name || null;
  return {
    ok: true,
    repository: nameWithOwner,
    recommended,
    branches: refs.nodes.map((ref) => ({
      name: String(ref.name || ''),
      oid: ref.target?.oid ? String(ref.target.oid) : null,
      recommended: String(ref.name || '') === recommended,
      selectable: true,
    })),
    pageInfo: {
      hasNextPage: refs.pageInfo?.hasNextPage === true,
      endCursor: refs.pageInfo?.endCursor || null,
    },
    blocker: null,
  };
}

export function listAllGitHubBranches(repository, { maxPages = 100, ...options } = {}) {
  const branches = [];
  let after = null;
  let recommended = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = listGitHubBranchPage(repository, { ...options, after });
    if (result.recommended) recommended = result.recommended;
    if (!result.ok) return { ...result, branches, recommended };
    branches.push(...result.branches);
    if (!result.pageInfo.hasNextPage) {
      return { ok: true, repository: result.repository, branches, recommended, pageInfo: result.pageInfo, blocker: null };
    }
    if (!result.pageInfo.endCursor || result.pageInfo.endCursor === after) {
      return {
        ok: false,
        repository: result.repository,
        branches,
        recommended,
        pageInfo: result.pageInfo,
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
    repository: parseRepositoryIdentity(repository).nameWithOwner,
    branches,
    recommended,
    pageInfo: { hasNextPage: true, endCursor: after },
    blocker: {
      code: 'github-branch-pagination-limit',
      message: 'Branch discovery exceeded its safety page limit.',
      recoveryAction: 'Refresh branches.',
    },
  };
}

export function filterRepositoryCatalog(repositories, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [...(repositories || [])];
  return (repositories || []).filter((repository) => [
    repository.nameWithOwner,
    repository.owner,
    repository.name,
    repository.visibility,
  ].some((value) => String(value || '').toLowerCase().includes(needle)));
}

export function filterBranchCatalog(branches, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [...(branches || [])];
  return (branches || []).filter((branch) => String(branch.name || '').toLowerCase().includes(needle));
}
