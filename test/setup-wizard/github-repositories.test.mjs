import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRepositoryCatalogFailure,
  filterBranchCatalog,
  filterRepositoryCatalog,
  listAllGitHubRepositories,
  listGitHubBranchPage,
  listGitHubRepositoryPage,
  normalizeGitHubRepository,
} from '../../src/setup-wizard/github-repositories.mjs';

function result({ ok = true, data = null, stderr = '' } = {}) {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stdout: data == null ? '' : JSON.stringify(data),
    stderr,
  };
}

function repository(overrides = {}) {
  return {
    id: 'R_1',
    name: 'project',
    nameWithOwner: 'acme/project',
    url: 'https://github.com/acme/project',
    sshUrl: 'git@github.com:acme/project.git',
    visibility: 'PRIVATE',
    isArchived: false,
    updatedAt: '2026-08-01T00:00:00Z',
    viewerPermission: 'WRITE',
    hasIssuesEnabled: true,
    owner: { login: 'acme' },
    defaultBranchRef: { name: 'main' },
    ...overrides,
  };
}

function repositoryPage(nodes, pageInfo = { hasNextPage: false, endCursor: null }) {
  return {
    data: {
      viewer: {
        repositories: { nodes, pageInfo },
      },
    },
  };
}

test('owned, collaborator, and organization repositories are normalized with capability details', () => {
  for (const permission of ['WRITE', 'MAINTAIN', 'ADMIN']) {
    const normalized = normalizeGitHubRepository(repository({ viewerPermission: permission }));
    assert.equal(normalized.selectable, true, permission);
    assert.equal(normalized.capabilities.read, true);
    assert.equal(normalized.capabilities.cloneFetch, true);
    assert.equal(normalized.capabilities.branchPush, true);
    assert.equal(normalized.capabilities.pullRequestCreate, true);
    assert.equal(normalized.capabilities.issueRead, true);
    assert.equal(normalized.capabilities.issueUpdate, true);
    assert.equal(normalized.capabilities.labelManage, true);
  }
});

test('archived, empty, read-only, and issues-disabled repositories stay visible with exact disabled reasons', () => {
  const cases = [
    [repository({ isArchived: true }), 'repository-archived'],
    [repository({ defaultBranchRef: null }), 'repository-empty'],
    [repository({ viewerPermission: 'READ' }), 'repository-write-required'],
    [repository({ hasIssuesEnabled: false }), 'repository-issues-required'],
  ];
  for (const [input, code] of cases) {
    const normalized = normalizeGitHubRepository(input);
    assert.equal(normalized.selectable, false);
    assert.ok(normalized.disabledReasons.some((reason) => reason.code === code), code);
    assert.equal(normalized.nameWithOwner, 'acme/project');
  }
});

test('repository page uses viewer affiliations, preserves pagination, and never mutates repositories', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push({ command, args: [...args] });
    return result({
      data: repositoryPage([repository()], { hasNextPage: true, endCursor: 'cursor-2' }),
    });
  };
  const page = listGitHubRepositoryPage({ runner, host: 'github.com', after: 'cursor-1', pageSize: 25 });
  assert.equal(page.ok, true);
  assert.equal(page.repositories[0].selectable, true);
  assert.deepEqual(page.pageInfo, { hasNextPage: true, endCursor: 'cursor-2' });
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com']);
  const query = calls[0].args.find((arg) => String(arg).startsWith('query='));
  assert.match(query, /OWNER,COLLABORATOR,ORGANIZATION_MEMBER/);
  assert.equal(calls[0].args.some((arg) => /mutation/i.test(String(arg))), false);
});

test('all-repository discovery follows cursors without duplicating mutation behavior', () => {
  const pages = [
    repositoryPage([repository({ nameWithOwner: 'acme/one', name: 'one' })], { hasNextPage: true, endCursor: 'next' }),
    repositoryPage([repository({ nameWithOwner: 'acme/two', name: 'two' })], { hasNextPage: false, endCursor: null }),
  ];
  const calls = [];
  const runner = (_command, args) => {
    calls.push([...args]);
    return result({ data: pages.shift() });
  };
  const catalog = listAllGitHubRepositories({ runner, pageSize: 1 });
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.repositories.map((repo) => repo.nameWithOwner), ['acme/one', 'acme/two']);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('after=next'));
});

test('SSO and authentication gaps return targeted troubleshooting only when matched', () => {
  assert.equal(classifyRepositoryCatalogFailure({ stderr: 'Resource protected by organization SAML enforcement' }).code, 'sso-authorization-required');
  assert.equal(classifyRepositoryCatalogFailure({ stderr: 'HTTP 401: Bad credentials' }).code, 'github-authentication-required');
  assert.equal(classifyRepositoryCatalogFailure({ stderr: 'network timeout' }).code, 'github-repository-catalog-unavailable');

  const page = listGitHubRepositoryPage({
    runner: () => result({ ok: false, stderr: 'SAML SSO authorization required' }),
  });
  assert.equal(page.ok, false);
  assert.equal(page.blocker.code, 'sso-authorization-required');
});

test('branch catalog returns searchable branches and recommends the repository default branch', () => {
  const runner = () => result({
    data: {
      data: {
        repository: {
          defaultBranchRef: { name: 'main' },
          refs: {
            nodes: [
              { name: 'feature/setup', target: { oid: 'abc' } },
              { name: 'main', target: { oid: 'def' } },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
  const branches = listGitHubBranchPage('acme/project', { runner });
  assert.equal(branches.ok, true);
  assert.equal(branches.recommended, 'main');
  assert.equal(branches.branches.find((branch) => branch.name === 'main').recommended, true);
  assert.equal(branches.branches.every((branch) => branch.selectable), true);
  assert.deepEqual(filterBranchCatalog(branches.branches, 'feat').map((branch) => branch.name), ['feature/setup']);
});

test('protected base branches are not disabled by catalog policy', () => {
  const normalized = normalizeGitHubRepository(repository({
    defaultBranchRef: { name: 'protected-main', branchProtectionRule: { requiresApprovingReviews: true } },
  }));
  assert.equal(normalized.defaultBranch, 'protected-main');
  assert.equal(normalized.selectable, true);
});

test('repository catalog search matches owner, name, full name, and visibility', () => {
  const catalog = [
    normalizeGitHubRepository(repository({ name: 'alpha', nameWithOwner: 'acme/alpha' })),
    normalizeGitHubRepository(repository({ name: 'beta', nameWithOwner: 'example/beta', owner: { login: 'example' }, visibility: 'PUBLIC' })),
  ];
  assert.deepEqual(filterRepositoryCatalog(catalog, 'ACME').map((repo) => repo.name), ['alpha']);
  assert.deepEqual(filterRepositoryCatalog(catalog, 'public').map((repo) => repo.name), ['beta']);
});
