import { run as defaultRun } from '../process.mjs';

const REPOSITORY_FIELDS = Object.freeze([
  'full_name',
  'name',
  'owner',
  'private',
  'visibility',
  'archived',
  'disabled',
  'default_branch',
  'updated_at',
  'size',
  'permissions',
]);

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); }
  catch { return null; }
}

function flattenPages(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((page) => Array.isArray(page) ? page : [page]).filter(Boolean);
}

function safeError(result, fallback) {
  const message = String(result?.stderr || result?.stdout || result?.error?.message || fallback || '').trim();
  return message
    .replace(/(authorization\s*:\s*)([^\r\n]+)/gi, '$1[REDACTED]')
    .replace(/((?:gh|github)[_-]?token\s*[=:]\s*)([^\s]+)/gi, '$1[REDACTED]');
}

function permissionRank(permissions = {}) {
  if (permissions.admin === true) return 'admin';
  if (permissions.maintain === true) return 'maintain';
  if (permissions.push === true) return 'write';
  if (permissions.triage === true) return 'triage';
  if (permissions.pull === true) return 'read';
  return 'none';
}

function capabilitySet(permissions = {}) {
  const admin = permissions.admin === true;
  const maintain = permissions.maintain === true || admin;
  const push = permissions.push === true || maintain;
  const triage = permissions.triage === true || push;
  const pull = permissions.pull === true || triage;
  return Object.freeze({
    read: pull,
    cloneFetch: pull,
    branchPush: push,
    prCreate: push,
    issueRead: pull,
    issueUpdate: triage,
    labelManagement: push,
  });
}

function selectionReasons(repository, capabilities) {
  const reasons = [];
  if (repository.archived === true) reasons.push('Repository is archived.');
  if (repository.disabled === true) reasons.push('Repository is disabled.');
  if (!repository.default_branch || Number(repository.size || 0) === 0) reasons.push('Repository is empty or has no default branch.');
  if (!capabilities.read) reasons.push('Repository contents are not readable with the active GitHub account.');
  if (!capabilities.cloneFetch) reasons.push('Repository cannot be cloned or fetched with the active GitHub account.');
  if (!capabilities.branchPush) reasons.push('Repository does not allow branch pushes with the active GitHub account.');
  if (!capabilities.prCreate) reasons.push('Repository does not allow pull-request creation with the active GitHub account.');
  if (!capabilities.issueRead) reasons.push('Repository issues are not readable with the active GitHub account.');
  if (!capabilities.issueUpdate) reasons.push('Repository issues cannot be updated with the active GitHub account.');
  if (!capabilities.labelManagement) reasons.push('Repository labels cannot be managed with the active GitHub account.');
  return [...new Set(reasons)];
}

export function normalizeGitHubRepository(repository = {}) {
  const permissions = repository.permissions && typeof repository.permissions === 'object'
    ? repository.permissions
    : {};
  const capabilities = capabilitySet(permissions);
  const reasons = selectionReasons(repository, capabilities);
  const fullName = String(repository.full_name || repository.nameWithOwner || '').trim();
  return {
    id: fullName,
    nameWithOwner: fullName,
    name: String(repository.name || fullName.split('/').at(-1) || '').trim(),
    owner: String(repository.owner?.login || fullName.split('/')[0] || '').trim(),
    visibility: String(repository.visibility || (repository.private ? 'private' : 'public')).trim(),
    archived: repository.archived === true,
    disabled: repository.disabled === true,
    empty: !repository.default_branch || Number(repository.size || 0) === 0,
    defaultBranch: repository.default_branch ? String(repository.default_branch) : null,
    updatedAt: repository.updated_at ? String(repository.updated_at) : null,
    permission: permissionRank(permissions),
    capabilities,
    selectable: reasons.length === 0,
    disabledReasons: reasons,
  };
}

export function githubSsoTroubleshooting(result) {
  const message = safeError(result, 'GitHub request failed.');
  const sso = /\bSAML\b|\bSSO\b|single sign[- ]on|resource protected by organization/i.test(message);
  return {
    ssoRequired: sso,
    message,
    recovery: sso
      ? 'Authorize the active GitHub CLI account for the organization SSO policy, then recheck repositories.'
      : null,
  };
}

function repositoryCatalogEndpoint() {
  return '/user/repos?per_page=100&affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&direction=desc';
}

export function listGitHubRepositories({ runner = defaultRun, env = process.env } = {}) {
  const result = runner('gh', [
    'api', '--method', 'GET', '--paginate', '--slurp', repositoryCatalogEndpoint(),
  ], { allowFailure: true, env });
  const parsed = result?.ok ? parseJson(result.stdout) : null;
  if (!result?.ok || parsed === null) {
    return {
      ok: false,
      repositories: [],
      troubleshooting: githubSsoTroubleshooting(result),
    };
  }
  const repositories = flattenPages(parsed)
    .map(normalizeGitHubRepository)
    .filter((repository) => repository.nameWithOwner)
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || 0) || 0;
      const rightTime = Date.parse(right.updatedAt || 0) || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.nameWithOwner.localeCompare(right.nameWithOwner);
    });
  return {
    ok: true,
    repositories,
    troubleshooting: null,
  };
}

function repositoryPath(nameWithOwner) {
  const value = String(nameWithOwner || '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) throw new Error('GitHub repository must use owner/name form.');
  return value.split('/').map(encodeURIComponent).join('/');
}

export function listGitHubBranches(nameWithOwner, { runner = defaultRun, env = process.env, defaultBranch = null } = {}) {
  const repository = repositoryPath(nameWithOwner);
  const result = runner('gh', [
    'api', '--method', 'GET', '--paginate', '--slurp', `/repos/${repository}/branches?per_page=100`,
  ], { allowFailure: true, env });
  const parsed = result?.ok ? parseJson(result.stdout) : null;
  if (!result?.ok || parsed === null) {
    return {
      ok: false,
      repository: nameWithOwner,
      branches: [],
      recommended: defaultBranch || null,
      troubleshooting: githubSsoTroubleshooting(result),
    };
  }
  const branches = flattenPages(parsed)
    .map((branch) => ({
      name: String(branch?.name || '').trim(),
      protected: branch?.protected === true,
    }))
    .filter((branch) => branch.name)
    .sort((left, right) => {
      if (left.name === defaultBranch) return -1;
      if (right.name === defaultBranch) return 1;
      return left.name.localeCompare(right.name);
    });
  return {
    ok: true,
    repository: nameWithOwner,
    branches,
    recommended: defaultBranch && branches.some((branch) => branch.name === defaultBranch)
      ? defaultBranch
      : branches[0]?.name || null,
    troubleshooting: null,
  };
}

export function catalogFields() {
  return [...REPOSITORY_FIELDS];
}
