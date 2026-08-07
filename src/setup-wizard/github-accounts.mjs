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

function commandResult(result) {
  return {
    ok: result?.ok === true,
    exitCode: result?.exitCode ?? null,
    stdout: String(result?.stdout || '').trim(),
    stderr: String(result?.stderr || '').trim(),
    timedOut: result?.timedOut === true,
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
  return {
    accounts,
    activeAccount: accounts.find((account) => account.active) || null,
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
      activeAccount: null,
      hosts: [],
      message: String(result?.stderr || result?.stdout || 'GitHub authentication status is unavailable.').trim(),
    };
  }
  return { ok: result.ok === true, ...parseGitHubAuthStatus(data), message: null };
}

function runAuthAction(args, { runner = defaultRun, env = process.env, inherit = false } = {}) {
  const result = runner('gh', args, { allowFailure: true, env, inherit });
  return commandResult(result);
}

export function loginGitHubAccount({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  return runAuthAction(['auth', 'login', '--web', '--hostname', String(host)], { runner, env, inherit: true });
}

export function switchGitHubAccount({ host = 'github.com', user, runner = defaultRun, env = process.env } = {}) {
  const login = String(user || '').trim();
  if (!login) throw new Error('GitHub account login is required.');
  return runAuthAction(['auth', 'switch', '--hostname', String(host), '--user', login], { runner, env });
}

export function reauthenticateGitHubAccount({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  return runAuthAction(['auth', 'refresh', '--hostname', String(host)], { runner, env, inherit: true });
}

export function logoutGitHubAccount({ host = 'github.com', user, runner = defaultRun, env = process.env } = {}) {
  const login = String(user || '').trim();
  if (!login) throw new Error('GitHub account login is required.');
  return runAuthAction(['auth', 'logout', '--hostname', String(host), '--user', login], { runner, env });
}

export function setupGitCredentialHelper({ host = 'github.com', runner = defaultRun, env = process.env } = {}) {
  const configured = runner('gh', ['auth', 'setup-git', '--hostname', String(host)], { allowFailure: true, env });
  if (!configured?.ok) {
    return { ok: false, configured: false, verified: false, message: String(configured?.stderr || configured?.stdout || 'Git credential setup failed.').trim() };
  }
  const verified = runner('git', ['config', '--global', '--get-regexp', '^credential\\..*\\.helper$'], { allowFailure: true, env });
  const output = `${verified?.stdout || ''}\n${verified?.stderr || ''}`;
  const usesGitHubCli = verified?.ok === true && /gh\s+auth\s+git-credential|gh auth git-credential/i.test(output);
  return {
    ok: usesGitHubCli,
    configured: true,
    verified: usesGitHubCli,
    message: usesGitHubCli ? 'Git credential helper is configured for GitHub CLI.' : 'GitHub CLI ran setup-git, but the credential helper could not be verified.',
  };
}

export function githubAccountServiceStatus(options = {}) {
  const cli = githubCliStatus(options);
  if (!cli.installed) return { cli, auth: { ok: false, accounts: [], activeAccount: null, hosts: [], message: 'GitHub CLI is not installed.' } };
  return { cli, auth: listGitHubAccounts(options) };
}
