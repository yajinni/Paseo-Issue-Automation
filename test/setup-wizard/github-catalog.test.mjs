import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogFields,
  githubSsoTroubleshooting,
  listGitHubBranches,
  listGitHubRepositories,
  normalizeGitHubRepository,
} from '../../src/setup-wizard/github-catalog.mjs';

function result({ ok = true, stdout = '', stderr = '' } = {}) {
  return { ok, stdout, stderr, exitCode: ok ? 0 : 1 };
}

function repository(overrides = {}) {
  return {
    full_name: 'acme/app',
    name: 'app',
    owner: { login: 'acme' },
    private: true,
    visibility: 'private',
    archived: false,
    disabled: false,
    default_branch: 'main',
    updated_at: '2026-08-06T20:00:00Z',
    size: 42,
    permissions: { pull: true, triage: true, push: true, maintain: false, admin: false },
    ...overrides,
  };
}

test('repository normalization exposes effective permission and all setup capabilities', () => {
  const normalized = normalizeGitHubRepository(repository());
  assert.equal(normalized.nameWithOwner, 'acme/app');
  assert.equal(normalized.owner, 'acme');
  assert.equal(normalized.visibility, 'private');
  assert.equal(normalized.permission, 'write');
  assert.equal(normalized.selectable, true);
  assert.deepEqual(normalized.disabledReasons, []);
  assert.deepEqual(normalized.capabilities, {
    read: true,
    cloneFetch: true,
    branchPush: true,
    prCreate: true,
    issueRead: true,
    issueUpdate: true,
    labelManagement: true,
  });
});

test('archived, empty, and read-only repositories remain visible with exact disabling reasons', () => {
  const archived = normalizeGitHubRepository(repository({ archived: true }));
  assert.equal(archived.selectable, false);
  assert.deepEqual(archived.disabledReasons, ['Repository is archived.']);

  const empty = normalizeGitHubRepository(repository({ default_branch: null, size: 0 }));
  assert.equal(empty.selectable, false);
  assert.ok(empty.disabledReasons.includes('Repository is empty or has no default branch.'));

  const readOnly = normalizeGitHubRepository(repository({
    permissions: { pull: true, triage: false, push: false, maintain: false, admin: false },
  }));
  assert.equal(readOnly.permission, 'read');
  assert.equal(readOnly.selectable, false);
  assert.ok(readOnly.disabledReasons.includes('Repository does not allow branch pushes with the active GitHub account.'));
  assert.ok(readOnly.disabledReasons.includes('Repository issues cannot be updated with the active GitHub account.'));
  assert.ok(readOnly.disabledReasons.includes('Repository labels cannot be managed with the active GitHub account.'));
});

test('repository catalog uses the active account user endpoint, pagination, and retains disabled repositories', () => {
  const calls = [];
  const pages = [
    [repository({ full_name: 'acme/newer', name: 'newer', updated_at: '2026-08-06T22:00:00Z' })],
    [repository({ full_name: 'acme/old', name: 'old', updated_at: '2026-08-01T22:00:00Z', archived: true })],
  ];
  const catalog = listGitHubRepositories({
    env: { PATH: '/bin' },
    runner: (command, args, options) => {
      calls.push({ command, args, options });
      return result({ stdout: JSON.stringify(pages) });
    },
  });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.repositories.length, 2);
  assert.equal(catalog.repositories[0].nameWithOwner, 'acme/newer');
  assert.equal(catalog.repositories[1].nameWithOwner, 'acme/old');
  assert.equal(catalog.repositories[1].selectable, false);
  assert.equal(calls[0].command, 'gh');
  assert.ok(calls[0].args.includes('--paginate'));
  assert.ok(calls[0].args.includes('--slurp'));
  assert.match(calls[0].args.at(-1), /^\/user\/repos\?/);
  assert.match(calls[0].args.at(-1), /organization_member/);
  assert.equal(calls[0].options.cwd, undefined);
});

test('triage permission permits issue updates but does not overstate branch or label management', () => {
  const triage = normalizeGitHubRepository(repository({
    permissions: { pull: true, triage: true, push: false, maintain: false, admin: false },
  }));
  assert.equal(triage.permission, 'triage');
  assert.equal(triage.capabilities.issueUpdate, true);
  assert.equal(triage.capabilities.branchPush, false);
  assert.equal(triage.capabilities.labelManagement, false);
  assert.equal(triage.selectable, false);
});

test('branch catalog is paginated, recommends the default branch, and allows protected bases', () => {
  const calls = [];
  const branches = listGitHubBranches('acme/app', {
    defaultBranch: 'main',
    runner: (command, args) => {
      calls.push({ command, args });
      return result({ stdout: JSON.stringify([
        [{ name: 'release', protected: false }],
        [{ name: 'main', protected: true }, { name: 'feature/test', protected: false }],
      ]) });
    },
  });
  assert.equal(branches.ok, true);
  assert.equal(branches.recommended, 'main');
  assert.deepEqual(branches.branches[0], { name: 'main', protected: true });
  assert.equal(branches.branches.some((branch) => branch.name === 'main' && branch.protected), true);
  assert.ok(calls[0].args.includes('--paginate'));
  assert.match(calls[0].args.at(-1), /^\/repos\/acme\/app\/branches\?/);
});

test('SSO authorization failures return targeted troubleshooting without leaking authorization data', () => {
  const troubleshooting = githubSsoTroubleshooting(result({
    ok: false,
    stderr: 'HTTP 403: Resource protected by organization SAML SSO. Authorization: Bearer secret-value',
  }));
  assert.equal(troubleshooting.ssoRequired, true);
  assert.match(troubleshooting.recovery, /Authorize .* SSO/i);
  assert.equal(troubleshooting.message.includes('secret-value'), false);

  const catalog = listGitHubRepositories({
    runner: () => result({ ok: false, stderr: 'SAML SSO authorization required' }),
  });
  assert.equal(catalog.ok, false);
  assert.equal(catalog.troubleshooting.ssoRequired, true);
});

test('repository catalog declares the metadata contract it consumes and performs no mutations', () => {
  assert.deepEqual(catalogFields(), [
    'full_name', 'name', 'owner', 'private', 'visibility', 'archived', 'disabled',
    'default_branch', 'updated_at', 'size', 'permissions',
  ]);
  const calls = [];
  listGitHubRepositories({
    runner: (_command, args) => { calls.push(args); return result({ stdout: '[]' }); },
  });
  listGitHubBranches('acme/app', {
    runner: (_command, args) => { calls.push(args); return result({ stdout: '[]' }); },
  });
  assert.equal(calls.every((args) => args.includes('GET')), true);
  assert.equal(calls.some((args) => args.some((arg) => /POST|PATCH|DELETE/i.test(String(arg)))), false);
});
