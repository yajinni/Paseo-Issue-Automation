import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addGitHubAccount,
  githubAccountServiceStatus,
  githubCliInstallGuidance,
  githubCliStatus,
  listGitHubAccounts,
  logoutGitHubAccount,
  parseGitHubAuthStatus,
  reauthenticateGitHubAccount,
  reconcileRepositorySelection,
  setupGitCredentialHelper,
  switchGitHubAccount,
} from '../../src/setup-wizard/github-accounts.mjs';

function result({ ok = true, stdout = '', stderr = '', exitCode = ok ? 0 : 1 } = {}) {
  return { ok, stdout, stderr, exitCode, timedOut: false };
}

function authJson(active = 'alice') {
  return JSON.stringify({
    hosts: {
      'github.com': [
        { host: 'github.com', login: 'alice', active: active === 'alice', state: 'success', token: 'must-not-leak' },
        { host: 'github.com', login: 'bob', active: active === 'bob', state: 'success', tokenSource: 'oauth_token' },
      ],
      'git.example.test': [
        { host: 'git.example.test', login: 'enterprise-user', active: true, state: 'success', credential: 'must-not-leak' },
      ],
    },
  });
}

test('GitHub CLI status works outside a repository and returns platform-aware install guidance', () => {
  const calls = [];
  const status = githubCliStatus({
    platform: 'win32',
    env: { PATH: 'C:\\Tools' },
    resolver: (command) => ({ available: command === 'gh', path: 'C:\\Tools\\gh.exe', source: 'path' }),
    runner: (command, args, options) => {
      calls.push({ command, args, options });
      return result({ stdout: 'gh version 2.80.0 (2026-07-01)\nhttps://github.com/cli/cli/releases/tag/v2.80.0' });
    },
  });
  assert.equal(status.installed, true);
  assert.equal(status.path, 'C:\\Tools\\gh.exe');
  assert.equal(status.version, 'gh version 2.80.0 (2026-07-01)');
  assert.equal(status.guidance.command, 'winget install --id GitHub.cli');
  assert.equal(calls[0].options.cwd, undefined);

  const missing = githubCliStatus({
    platform: 'linux',
    resolver: () => ({ available: false, path: null, source: 'missing' }),
  });
  assert.equal(missing.installed, false);
  assert.match(missing.guidance.docsUrl, /install_linux/);
  assert.equal(githubCliInstallGuidance('darwin').command, 'brew install gh');
});

test('auth status normalizes multiple accounts and never returns tokens or credentials', () => {
  const parsed = parseGitHubAuthStatus(JSON.parse(authJson('bob')));
  assert.equal(parsed.accounts.length, 3);
  assert.equal(parsed.activeAccount.login, 'bob');
  assert.deepEqual(parsed.hosts, ['git.example.test', 'github.com']);
  assert.equal(JSON.stringify(parsed).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(parsed).includes('oauth_token'), false);

  const listed = listGitHubAccounts({ runner: () => result({ stdout: authJson('alice') }) });
  assert.equal(listed.ok, true);
  assert.equal(listed.activeAccount.login, 'alice');
  assert.equal(JSON.stringify(listed).includes('must-not-leak'), false);
});

test('combined account service reports missing CLI without attempting authentication', () => {
  let runnerCalls = 0;
  const status = githubAccountServiceStatus({
    resolver: () => ({ available: false, path: null, source: 'missing' }),
    runner: () => { runnerCalls += 1; return result(); },
  });
  assert.equal(status.cli.installed, false);
  assert.equal(status.auth.ok, false);
  assert.equal(runnerCalls, 0);
});

test('add/login uses the browser flow and verifies the resulting active account', () => {
  const calls = [];
  const runner = (command, args, options = {}) => {
    calls.push({ command, args: [...args], inherit: options.inherit === true });
    if (args[0] === 'auth' && args[1] === 'login') return result({ stdout: 'browser flow completed' });
    if (args[0] === 'auth' && args[1] === 'status') return result({ stdout: authJson('bob') });
    return result({ ok: false, stderr: 'unexpected command' });
  };
  const login = addGitHubAccount({ host: 'github.com', runner });
  assert.equal(login.ok, true);
  assert.equal(login.verified, true);
  assert.equal(login.account.login, 'bob');
  assert.deepEqual(calls[0].args, ['auth', 'login', '--web', '--hostname', 'github.com']);
  assert.equal(calls[0].inherit, true);
});

test('failed or cancelled browser login does not perform any follow-up state/status operation', () => {
  const calls = [];
  const login = addGitHubAccount({
    runner: (_command, args) => {
      calls.push([...args]);
      return result({ ok: false, stderr: 'login cancelled by user' });
    },
  });
  assert.equal(login.ok, false);
  assert.equal(login.verified, false);
  assert.equal(login.account, null);
  assert.equal(calls.length, 1);
  assert.match(login.message, /cancelled/i);
});

test('switch verifies the requested account became active and exposes no token fields', () => {
  const calls = [];
  const runner = (_command, args) => {
    calls.push([...args]);
    if (args[1] === 'switch') return result();
    if (args[1] === 'status') return result({ stdout: authJson('bob') });
    return result({ ok: false, stderr: 'unexpected' });
  };
  const switched = switchGitHubAccount({ host: 'github.com', user: 'bob', runner });
  assert.equal(switched.ok, true);
  assert.equal(switched.verified, true);
  assert.equal(switched.account.login, 'bob');
  assert.equal(JSON.stringify(switched).includes('must-not-leak'), false);
  assert.deepEqual(calls[0], ['auth', 'switch', '--hostname', 'github.com', '--user', 'bob']);
});

test('reauthenticate verifies an active account and logout verifies removal', () => {
  let loggedOut = false;
  const runner = (_command, args) => {
    if (args[1] === 'refresh') return result();
    if (args[1] === 'logout') { loggedOut = true; return result(); }
    if (args[1] === 'status') {
      const data = JSON.parse(authJson('alice'));
      if (loggedOut) data.hosts['github.com'] = data.hosts['github.com'].filter((account) => account.login !== 'alice');
      return result({ stdout: JSON.stringify(data) });
    }
    return result({ ok: false, stderr: 'unexpected' });
  };
  const refreshed = reauthenticateGitHubAccount({ host: 'github.com', runner });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.account.login, 'alice');

  const logout = logoutGitHubAccount({ host: 'github.com', user: 'alice', runner });
  assert.equal(logout.ok, true);
  assert.equal(logout.verified, true);
});

test('Git credential-helper setup is verified for the selected host', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'gh') return result();
    if (command === 'git') return result({ stdout: '!/usr/bin/gh auth git-credential' });
    return result({ ok: false });
  };
  const setup = setupGitCredentialHelper({ host: 'github.com', runner });
  assert.equal(setup.ok, true);
  assert.equal(setup.verified, true);
  assert.deepEqual(calls[0], { command: 'gh', args: ['auth', 'setup-git', '--hostname', 'github.com'] });
  assert.deepEqual(calls[1], { command: 'git', args: ['config', '--global', '--get-all', 'credential.https://github.com.helper'] });
});

test('repository selection survives account changes unless catalog recheck proves access was lost', () => {
  const selected = { nameWithOwner: 'acme/project' };
  const unknown = reconcileRepositorySelection(selected, null);
  assert.equal(unknown.selection, selected);
  assert.equal(unknown.invalidated, false);
  assert.equal(unknown.recheckRequired, true);

  const retained = reconcileRepositorySelection(selected, [
    { nameWithOwner: 'acme/project', selectable: true },
    { nameWithOwner: 'other/repo', selectable: true },
  ]);
  assert.equal(retained.selection, selected);
  assert.equal(retained.invalidated, false);

  const lost = reconcileRepositorySelection(selected, [{ nameWithOwner: 'acme/project', selectable: false }]);
  assert.equal(lost.selection, null);
  assert.equal(lost.invalidated, true);
});
