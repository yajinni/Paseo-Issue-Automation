import { resolveCommand, run } from './process.mjs';
import { probePaseo } from './setup-discovery.mjs';

export const SETUP_REQUIREMENT_IDS = Object.freeze([
  'git',
  'githubCli',
  'githubAuthenticated',
  'paseoCli',
  'paseoReachable',
  'remote',
]);

const REQUIREMENT_CACHE_MS = Number.POSITIVE_INFINITY;
const cache = new Map();

function defaultRequirements() {
  return {
    git: false,
    githubCli: false,
    githubAuthenticated: false,
    githubMessage: 'Not checked yet.',
    paseoCli: false,
    paseoReachable: false,
    paseoMessage: 'Not checked yet.',
    paseoCommandPath: null,
    paseoCommandSource: null,
    paseoProbe: { method: 'not-checked', status: null, attempts: [] },
    remote: null,
    repository: null,
    defaultBranch: null,
  };
}

function repositoryFromRemote(remote) {
  const text = String(remote || '').trim();
  const match = text.match(/github\.com(?::|\/)([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function defaultBranchFromRefs(root) {
  const result = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: root,
    allowFailure: true,
    timeoutMs: 3_000,
  });
  if (!result.ok) return null;
  return String(result.stdout || '').trim().replace(/^origin\//, '') || null;
}

function entry(root) {
  let current = cache.get(root);
  if (!current) {
    current = { values: defaultRequirements(), checked: new Map() };
    cache.set(root, current);
  }
  return current;
}

function fresh(current, id) {
  const checkedAt = current.checked.get(id) || 0;
  return Date.now() - checkedAt < REQUIREMENT_CACHE_MS;
}

function save(root, id, patch, state) {
  const current = entry(root);
  current.values = { ...current.values, ...patch };
  current.checked.set(id, Date.now());
  return {
    id,
    ok: state.ok === true,
    value: state.value,
    requirements: { ...current.values },
    checkedAt: new Date().toISOString(),
  };
}

export function checkSetupRequirement(root, id, { force = false } = {}) {
  if (!SETUP_REQUIREMENT_IDS.includes(id)) throw new Error(`Unknown setup requirement: ${id}`);
  const current = entry(root);
  if (!force && fresh(current, id)) {
    const values = current.values;
    const state = requirementState(id, values);
    return {
      id,
      ok: state.ok,
      value: state.value,
      requirements: { ...values },
      checkedAt: new Date(current.checked.get(id)).toISOString(),
      cached: true,
    };
  }

  if (id === 'git') {
    const available = resolveCommand('git').available;
    const repository = available
      ? run('git', ['rev-parse', '--show-toplevel'], { cwd: root, allowFailure: true, timeoutMs: 3_000 })
      : { ok: false };
    const ok = available && repository.ok;
    return save(root, id, { git: ok }, {
      ok,
      value: ok ? 'Installed and repository detected' : 'Git or the repository checkout was not detected',
    });
  }

  if (id === 'githubCli') {
    const ok = resolveCommand('gh').available;
    return save(root, id, { githubCli: ok }, {
      ok,
      value: ok ? 'GitHub CLI detected' : 'GitHub CLI was not detected',
    });
  }

  if (id === 'githubAuthenticated') {
    const cli = resolveCommand('gh').available;
    const result = cli
      ? run('gh', ['auth', 'status'], { cwd: root, allowFailure: true, timeoutMs: 5_000 })
      : { ok: false, stderr: 'GitHub CLI is not installed.' };
    const message = result.ok ? 'Authenticated for GitHub access' : String(result.stderr || result.stdout || 'GitHub CLI is not authenticated.').trim();
    return save(root, id, {
      githubCli: cli,
      githubAuthenticated: result.ok === true,
      githubMessage: message,
    }, { ok: result.ok === true, value: message });
  }

  if (id === 'paseoCli') {
    const resolution = resolveCommand('paseo');
    const value = resolution.available
      ? `${resolution.path || 'Paseo CLI detected'}${resolution.source ? ` · ${resolution.source}` : ''}`
      : 'Paseo CLI was not detected';
    return save(root, id, {
      paseoCli: resolution.available,
      paseoCommandPath: resolution.path,
      paseoCommandSource: resolution.source,
    }, { ok: resolution.available, value });
  }

  if (id === 'paseoReachable') {
    const resolution = resolveCommand('paseo');
    const paseo = resolution.available
      ? probePaseo(root, { timeoutMs: 6_000 })
      : {
          reachable: false,
          method: 'missing-cli',
          message: 'Paseo CLI was not found on PATH or in a standard Paseo Desktop installation folder.',
          status: null,
          attempts: [],
        };
    return save(root, id, {
      paseoCli: resolution.available,
      paseoCommandPath: resolution.path,
      paseoCommandSource: resolution.source,
      paseoReachable: paseo.reachable,
      paseoMessage: paseo.message,
      paseoProbe: {
        method: paseo.method,
        status: paseo.status,
        attempts: paseo.attempts,
      },
    }, { ok: paseo.reachable, value: paseo.message });
  }

  const result = run('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    allowFailure: true,
    timeoutMs: 3_000,
  });
  const remote = result.ok ? String(result.stdout || '').trim() : null;
  return save(root, id, {
    remote,
    repository: repositoryFromRemote(remote),
    defaultBranch: defaultBranchFromRefs(root),
  }, {
    ok: Boolean(remote),
    value: remote || String(result.stderr || result.stdout || 'No origin remote detected').trim(),
  });
}

export function requirementState(id, requirements = {}) {
  const states = {
    git: {
      ok: requirements.git === true,
      value: requirements.git ? 'Installed and repository detected' : 'Git or the repository checkout was not detected',
    },
    githubCli: {
      ok: requirements.githubCli === true,
      value: requirements.githubCli ? 'GitHub CLI detected' : 'GitHub CLI was not detected',
    },
    githubAuthenticated: {
      ok: requirements.githubAuthenticated === true,
      value: requirements.githubMessage || (requirements.githubAuthenticated ? 'Authenticated for GitHub access' : 'GitHub CLI is not authenticated'),
    },
    paseoCli: {
      ok: requirements.paseoCli === true,
      value: requirements.paseoCli
        ? `${requirements.paseoCommandPath || 'Paseo CLI detected'}${requirements.paseoCommandSource ? ` · ${requirements.paseoCommandSource}` : ''}`
        : 'Paseo CLI was not detected',
    },
    paseoReachable: {
      ok: requirements.paseoReachable === true,
      value: requirements.paseoMessage || (requirements.paseoReachable ? 'Paseo daemon reachable' : 'Paseo daemon unreachable'),
    },
    remote: {
      ok: Boolean(requirements.remote),
      value: requirements.remote || 'No origin remote detected',
    },
  };
  return states[id];
}

export function setupRequirements(root, { force = false } = {}) {
  for (const id of SETUP_REQUIREMENT_IDS) checkSetupRequirement(root, id, { force });
  return { ...entry(root).values };
}

export function clearSetupRequirementCache(root) {
  if (root) cache.delete(root);
  else cache.clear();
}
