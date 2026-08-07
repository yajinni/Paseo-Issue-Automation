import assert from 'node:assert/strict';
import test from 'node:test';
import {
  githubAccountServiceStatus,
  githubCliInstallGuidance,
  listGitHubAccounts,
  loginGitHubAccount,
  logoutGitHubAccount,
  parseGitHubAuthStatus,
  reauthenticateGitHubAccount,
  setupGitCredentialHelper,
  switchGitHubAccount,
} from '../../src/setup-wizard/github-accounts.mjs';

test('GitHub auth status supports multiple accounts and never returns token-shaped fields', () => {
  const parsed = parseGitHubAuthStatus({
    hosts: {
      'github.com': [
        { login: 'secondary', active: false, state: 'success', token: 'never-return-this' },
        { login: 'primary', active: true, state: 'success', tokenSource: 'keyring', oauthToken: 'also-secret' },
      ],
      'ghe.example.com': { login: 'enterprise', active: false, state: 'success', password: 'nope' },
    },
  });
  assert.deepEqual(parsed.accounts, [
    { host: 'github.com', login: 'primary', active: true, state: 'success' },
    { host: 'ghe.example.com', login: 'enterprise', active: false, state: 'success' },
    { host: 'github.com', login: 'secondary', active: false, state: 'success' },
  ]);
  assert.deepEqual(parsed.activeAccount, { host: 'github.com', login: 'primary', active: true, state: 'success' });
  assert.equal(JSON.stringify(parsed).includes('never-return-this'), false);
  assert.equal(JSON.stringify(parsed).includes('also-secret'), false);
  assert.equal(JSON.stringify(parsed).includes('keyring'), false);
});

test('account discovery uses the token-free hosts JSON field and works without repository cwd', () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({ hosts: { 'github.com': [{ login: 'octo', active: true, state: 'success' }] } }),
      stderr: '',
    };
  };
  const auth = listGitHubAccounts({ runner, env: { PATH: '/bin' } });
  assert.equal(auth.ok, true);
  assert.equal(auth.activeAccount.login, 'octo');
  assert.deepEqual(calls[0].args, ['auth', 'status', '--json', 'hosts']);
  assert.equal(Object.hasOwn(calls[0].options, 'cwd'), false);
});

test('browser login, switch, reauthenticate, and logout use explicit host/account operations', () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, inherit: options.inherit === true });
    return { ok: true, exitCode: 0, stdout: '', stderr: '' };
  };
  loginGitHubAccount({ host: 'github.com', runner });
  switchGitHubAccount({ host: 'github.com', user: 'octo', runner });
  reauthenticateGitHubAccount({ host: 'github.com', runner });
  logoutGitHubAccount({ host: 'github.com', user: 'octo', runner });
  assert.deepEqual(calls, [
    { command: 'gh', args: ['auth', 'login', '--web', '--hostname', 'github.com'], inherit: true },
    { command: 'gh', args: ['auth', 'switch', '--hostname', 'github.com', '--user', 'octo'], inherit: false },
    { command: 'gh', args: ['auth', 'refresh', '--hostname', 'github.com'], inherit: true },
    { command: 'gh', args: ['auth', 'logout', '--hostname', 'github.com', '--user', 'octo'], inherit: false },
  ]);
  assert.equal(calls.some((call) => call.args.includes('--show-token')), false);
  assert.equal(calls.some((call) => call.args.includes('--insecure-storage')), false);
});

test('cancelled or failed login returns a safe result instead of changing setup state itself', () => {
  const runner = () => ({ ok: false, exitCode: 1, stdout: '', stderr: 'login cancelled' });
  const result = loginGitHubAccount({ runner });
  assert.deepEqual(result, {
    ok: false,
    exitCode: 1,
    stdout: '',
    stderr: 'login cancelled',
    timedOut: false,
  });
});

test('Git credential helper setup is verified through Git global configuration', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (command === 'gh') return { ok: true, stdout: '', stderr: '' };
    return {
      ok: true,
      stdout: 'credential.https://github.com.helper !/usr/bin/gh auth git-credential',
      stderr: '',
    };
  };
  const result = setupGitCredentialHelper({ runner });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.deepEqual(calls[0], ['gh', ['auth', 'setup-git', '--hostname', 'github.com']]);
  assert.deepEqual(calls[1], ['git', ['config', '--global', '--get-regexp', '^credential\\..*\\.helper$']]);
});

test('installation guidance is platform-aware without requiring repository context', () => {
  assert.match(githubCliInstallGuidance('win32').command, /winget/);
  assert.match(githubCliInstallGuidance('darwin').command, /brew/);
  assert.equal(githubCliInstallGuidance('linux').command, null);
});

test('combined account status reports missing CLI without attempting auth', () => {
  let runs = 0;
  const result = githubAccountServiceStatus({
    platform: 'linux',
    resolver: () => ({ available: false, source: 'missing', path: null }),
    runner: () => { runs += 1; return { ok: false }; },
  });
  assert.equal(result.cli.installed, false);
  assert.equal(result.auth.ok, false);
  assert.equal(runs, 0);
});
