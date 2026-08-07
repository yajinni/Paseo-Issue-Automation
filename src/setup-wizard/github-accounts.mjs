import { resolveCommand, run as defaultRun } from '../process.mjs';

const TOKEN_KEY = /(?:token|secret|password|cookie|authorization|credential)/i;

function safeClone(value) {
  if (Array.isArray(value)) return value.map(safeClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !TOKEN_KEY.test(key))
      .map(([key, child]) => [key, safeClone(child)]));
  }
  return value;
}

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); }
  catch { return null; }
}

function safeMessage(result, fallback = '') {
  const text = String(result?.stderr || result?.stdout || result?.error?.message || fallback).trim();
  return text
    .replace(/(authorization\s*:\s*)([^\r\n]+)/gi, '$1[REDACTED]')
    .replace(/((?:gh|github)[_-]?token\s*[=:]\s*)([^\s]+)/gi, '$1[REDACTED]');
}

function commandResult(result, fallback) {
  return {
    ok: result?.ok === true,
    exitCode: result?.exitCode ?? null,
    timedOut: result?.timedOut === true,
    message: safeMessage(result, fallback) || null,
  };
}

export function githubCliInstallGuidance(platform = process.platform) {
  const guidance = {
    win32: {
      platform: 'Windows',
      command: 'winget install --id GitHub.cli',
      docsUrl: 'https://cli.github.com/',
    },
    darwin: {
      platform: 'macOS',
      command: 'brew install gh',
      docsUrl: 'https://cli.github.com/',
    },
    linux: {
      platform: 'Linux',
      command: null,
      docsUrl: 'https://github.com/cli/cli/blob/trunk/docs/install_linux.md',
    },
  };
  return guidance[platform] || { platform, command: null, docsUrl: 'https://cli.github.com/' };
}

export function githubCliStatus({ resolver = resolveCommand, runner = defaultRun, platform = process.platform, env = process.env } = {}) {
  const resolution = resolver('gh', { env, platform });
  if (!resolution.available) {
    return {
      installed: false,
      path: null,
      source: resolution.source || 'missing',
      version: null,
      guidance: githubCliInstallGuidance(platform),
    };
  }
  const result = runner('gh', ['--version'], { allowFailure: true, env });
  return {
    installed: result?.ok === true,
    path: resolution.path || result?.resolvedCommand || 'gh',
    source: resolution.source || result?.resolutionSource || 'path',
    version: String(result?.stdout || result?.stderr || '').split(/\r?\n/)[0].trim() || null,
    guidance: githubCliInstallGuidance(platform),
  };
}

function normalizeAccount(host, account = {}) {
  const login = String(account.login || account.user || '').trim();
  if (!login) return null;
  return {
    host: String(account.host || host || 'github.com'),
    login,
    active: account.active === true,
    state: String(account.state || account.status || '').trim() || null,
  };
}

export function parseGitHubAuthStatus(value) {
  const safe = safeClone(value || {});
  const hosts = safe.hosts && typeof safe.hosts === 'object' ? safe.hosts : {};
  const accounts = [];
  for (const [host, entries] of Object.entries(hosts)) {
    const rows = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? [entries] : [];
    for (const row of rows) {
      const account = normalizeAccount(host, row);
      if (account) accounts.push(account);
    }
  }
  accounts.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    if (left.host !== right.host) return left.host.localeCompare(right.host);
    return left.login.localeCompare(right.login);
  });
  const activeAccounts = Object.fromEntries(
    [...new Set(accounts.map((account) => account.host))]
      .sort()
      .map((host) => [host, accounts.find((account) => account.host === host && account.active) || null]),
  );
  return {
    accounts,
    activeAccounts,
    activeAccount: activeAccounts['github.com'] || accounts.find((account) => account.active) || null,
    hosts: [...new Set(accounts.map((account) => account.host))].sort(),
  };
}

export function listGitHubAccounts({ runner = defaultRun, env = process.env } = {}) {
  const result = runner('gh', ['auth', 'status', '--json', 'hosts'], { allowFailure: true, env });
  const data = result?.stdout ? parseJson(result.stdout) : null;
  if (!data) {
    return {
      ok: false,
      accounts: [],
      activeAccounts: {},
      activeAccount: null,
      hosts: [],
      message: safeMessage(result, 'GitHub authentication status is unavailable.'),
    };
  }
  return { ok: true, ...parseGitHubAuthStatus(data), message: null };
}

function runAuthAction(args, { runner = defaultRun, env = process.env, inherit = false } = {}) {
  const result = runner('gh', args, { allowFailure: true, env, inherit });
  return commandResult(result, 'GitHub authentication action failed.');
}

function verifiedAccount(auth, host, user = null) {
  const expectedHost = String(host || 'github.com');
  const expectedUser = user == null ? null : String(user).trim();
  return auth.accounts.find((account) => account.active
    && account.host === expectedHost
    && (!expectedUser || account.login === expectedUser)) || null;
}

export function loginGitHubAccount({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  const action = runAuthAction(['auth', 'login', '--web', '--hostname', String(host)], { runner, env, inherit: true });
  if (!action.ok) return { ...action, verified: false, account: null };
  const auth = listGitHubAccounts({ runner, env });
  const account = verifiedAccount(auth, host);
  return {
    ...action,
    ok: action.ok && Boolean(account),
    verified: Boolean(account),
    account,
    message: account ? `Authenticated as ${account.login} on ${account.host}.` : 'GitHub login completed, but the active account could not be verified.',
  };
}

export function addGitHubAccount(options = {}) {
  return loginGitHubAccount(options);
}

export function switchGitHubAccount({ host = 'github.com', user, runner = defaultRun, env = process.env } = {}) {
  const login = String(user || '').trim();
  if (!login) throw new Error('GitHub account login is required.');
  const action = runAuthAction(['auth', 'switch', '--hostname', String(host), '--user', login], { runner, env });
  if (!action.ok) return { ...action, verified: false, account: null };
  const auth = listGitHubAccounts({ runner, env });
  const account = verifiedAccount(auth, host, login);
  return {
    ...action,
    ok: action.ok && Boolean(account),
    verified: Boolean(account),
    account,
    message: account ? `Active GitHub account is now ${account.login} on ${account.host}.` : 'GitHub CLI reported a successful switch, but the active account did not match the requested account.',
  };
}

export function reauthenticateGitHubAccount({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  const action = runAuthAction(['auth', 'refresh', '--hostname', String(host)], { runner, env, inherit: true });
  if (!action.ok) return { ...action, verified: false, account: null };
  const auth = listGitHubAccounts({ runner, env });
  const account = verifiedAccount(auth, host);
  return {
    ...action,
    ok: action.ok && Boolean(account),
    verified: Boolean(account),
    account,
    message: account ? `Authentication refreshed for ${account.login} on ${account.host}.` : 'GitHub authentication refresh completed, but no active account could be verified.',
  };
}

export function logoutGitHubAccount({ host = 'github.com', user, runner = defaultRun, env = process.env } = {}) {
  const login = String(user || '').trim();
  if (!login) throw new Error('GitHub account login is required.');
  const action = runAuthAction(['auth', 'logout', '--hostname', String(host), '--user', login], { runner, env });
  if (!action.ok) return { ...action, verified: false };
  const auth = listGitHubAccounts({ runner, env });
  const stillPresent = auth.accounts.some((account) => account.host === String(host) && account.login === login);
  return {
    ...action,
    ok: action.ok && !stillPresent,
    verified: !stillPresent,
    message: stillPresent ? 'GitHub CLI reported logout success, but the account is still present.' : `Logged out ${login} on ${host}.`,
  };
}

export function setupGitCredentialHelper({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  const hostname = String(host);
  const configured = runner('gh', ['auth', 'setup-git', '--hostname', hostname], { allowFailure: true, env });
  if (!configured?.ok) {
    return { ok: false, configured: false, verified: false, message: safeMessage(configured, 'Git credential setup failed.') };
  }
  const key = `credential.https://${hostname}.helper`;
  const verified = runner('git', ['config', '--global', '--get-all', key], { allowFailure: true, env });
  const output = String(verified?.stdout || '');
  const usesGitHubCli = verified?.ok === true && /gh\s+auth\s+git-credential|gh auth git-credential/i.test(output);
  return {
    ok: usesGitHubCli,
    configured: true,
    verified: usesGitHubCli,
    message: usesGitHubCli ? 'Git credential helper is configured for GitHub CLI.' : 'GitHub CLI ran setup-git, but the credential helper could not be verified.',
  };
}

function repositoryIdentity(repository) {
  if (!repository) return null;
  if (typeof repository === 'string') return repository.trim() || null;
  return String(repository.nameWithOwner || repository.fullName || repository.repository || '').trim() || null;
}

export function reconcileRepositorySelection(selectedRepository, accessibleRepositories) {
  const selectedId = repositoryIdentity(selectedRepository);
  if (!selectedId) return { selection: selectedRepository || null, invalidated: false, recheckRequired: false };
  if (!Array.isArray(accessibleRepositories)) {
    return { selection: selectedRepository, invalidated: false, recheckRequired: true };
  }
  const accessible = accessibleRepositories.some((repository) => {
    const id = repositoryIdentity(repository);
    return id === selectedId && repository?.selectable !== false;
  });
  return accessible
    ? { selection: selectedRepository, invalidated: false, recheckRequired: false }
    : { selection: null, invalidated: true, recheckRequired: false };
}

export function githubAccountServiceStatus(options = {}) {
  const cli = githubCliStatus(options);
  if (!cli.installed) return { cli, auth: { ok: false, accounts: [], activeAccounts: {}, activeAccount: null, hosts: [], message: 'GitHub CLI is not installed.' } };
  return { cli, auth: listGitHubAccounts(options) };
}
