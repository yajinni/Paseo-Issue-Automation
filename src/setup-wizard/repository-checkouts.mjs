import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { managerHome, listRepositories, addRepository } from '../repository-registry.mjs';
import { run as defaultRun } from '../process.mjs';

export function managedRepositoriesRoot(options = {}) {
  return path.join(options.rootDir || managerHome(options), 'managed-repositories');
}

export function normalizeGitRemote(value) {
  const remote = String(value || '').trim();
  if (!remote) return null;
  let host;
  let owner;
  let name;

  let match = remote.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/i);
  if (match) [, host, owner, name] = match;
  if (!match) {
    match = remote.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i);
    if (match) [, host, owner, name] = match;
  }
  if (!match) {
    match = remote.match(/^ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/i);
    if (match) [, host, owner, name] = match;
  }
  if (!match || !host || !owner || !name) return null;
  const normalizedName = String(name).replace(/\.git$/i, '');
  return {
    host: String(host).toLowerCase(),
    owner: String(owner),
    name: normalizedName,
    nameWithOwner: `${owner}/${normalizedName}`,
    identity: `${String(host).toLowerCase()}/${String(owner).toLowerCase()}/${normalizedName.toLowerCase()}`,
  };
}

function repositoryIdentity(repository) {
  if (typeof repository === 'string') {
    const [owner, name, ...extra] = repository.trim().split('/');
    if (!owner || !name || extra.length) throw new Error('Repository must use owner/name form.');
    return { host: 'github.com', owner, name, nameWithOwner: `${owner}/${name}`, identity: `github.com/${owner.toLowerCase()}/${name.toLowerCase()}` };
  }
  const nameWithOwner = String(repository?.nameWithOwner || repository?.repository || '').trim();
  const [owner, name, ...extra] = nameWithOwner.split('/');
  if (!owner || !name || extra.length) throw new Error('Repository must use owner/name form.');
  const host = String(repository?.host || 'github.com').toLowerCase();
  return { host, owner, name, nameWithOwner, identity: `${host}/${owner.toLowerCase()}/${name.toLowerCase()}` };
}

function candidatePathFromWorkspace(workspace) {
  for (const key of ['path', 'repositoryPath', 'root', 'cwd', 'directory']) {
    const value = String(workspace?.[key] || '').trim();
    if (value) return path.resolve(value);
  }
  return null;
}

function directManagedChildren(root) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.includes('.partial-'))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

export function repositoryCheckoutCandidatePaths({
  registeredRepositories = [],
  paseoWorkspaces = [],
  managedRoot,
} = {}) {
  const values = [
    ...(registeredRepositories || []).map((entry) => entry?.path),
    ...(paseoWorkspaces || []).map(candidatePathFromWorkspace),
    ...directManagedChildren(managedRoot),
  ];
  const seen = new Set();
  return values
    .map((value) => value ? path.resolve(String(value)) : null)
    .filter(Boolean)
    .filter((value) => {
      const key = process.platform === 'win32' ? value.toLowerCase() : value;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function safeWritable(directory) {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function cleanPorcelain(value) {
  return String(value || '').trim() === '';
}

export function validateCheckoutCandidate(candidatePath, repository, baseBranch, {
  runner = defaultRun,
  remoteProbe = null,
} = {}) {
  const requested = path.resolve(String(candidatePath || '').trim());
  const target = repositoryIdentity(repository);
  const reasons = [];
  if (!existsSync(requested)) {
    return { path: requested, valid: false, safe: false, reasons: [{ code: 'checkout-missing', message: 'Checkout path does not exist.' }] };
  }
  try {
    if (!statSync(requested).isDirectory()) reasons.push({ code: 'checkout-not-directory', message: 'Checkout path is not a directory.' });
  } catch {
    reasons.push({ code: 'checkout-inaccessible', message: 'Checkout path cannot be inspected.' });
  }

  const rootResult = runner('git', ['rev-parse', '--show-toplevel'], { cwd: requested, allowFailure: true });
  const root = rootResult?.ok && rootResult.stdout ? path.resolve(rootResult.stdout) : null;
  if (!root || root !== requested) reasons.push({ code: 'checkout-not-root', message: 'Candidate is not the root of an accessible Git repository.' });

  let remote = null;
  let normalizedRemote = null;
  if (root) {
    const remoteResult = runner('git', ['remote', 'get-url', 'origin'], { cwd: root, allowFailure: true });
    remote = remoteResult?.ok ? String(remoteResult.stdout || '').trim() : null;
    normalizedRemote = normalizeGitRemote(remote);
    if (!normalizedRemote || normalizedRemote.identity !== target.identity) {
      reasons.push({ code: 'checkout-remote-mismatch', message: `Origin does not match ${target.nameWithOwner}.` });
    }

    const status = runner('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: root, allowFailure: true });
    if (!status?.ok) reasons.push({ code: 'checkout-status-unavailable', message: 'Working-tree status could not be read.' });
    else if (!cleanPorcelain(status.stdout)) reasons.push({ code: 'checkout-dirty', message: 'Checkout has uncommitted or untracked work and will not be modified.' });

    if (!safeWritable(root)) reasons.push({ code: 'checkout-not-writable', message: 'Checkout is not writable.' });

    const probe = remoteProbe
      ? remoteProbe({ root, remote, repository: target, baseBranch })
      : runner('git', ['ls-remote', '--exit-code', 'origin', `refs/heads/${baseBranch}`], { cwd: root, allowFailure: true });
    if (!probe?.ok) reasons.push({ code: 'checkout-fetch-unavailable', message: `Origin or base branch ${baseBranch} cannot be read.` });
  }

  return {
    path: requested,
    root,
    remote,
    normalizedRemote,
    repository: target.nameWithOwner,
    baseBranch: String(baseBranch || ''),
    writable: root ? safeWritable(root) : false,
    dirty: reasons.some((reason) => reason.code === 'checkout-dirty'),
    valid: reasons.length === 0,
    safe: reasons.length === 0,
    managed: false,
    reasons,
  };
}

function managedDirectoryName(repository) {
  const target = repositoryIdentity(repository);
  return `${target.owner.toLowerCase()}--${target.name.toLowerCase()}`.replace(/[^a-z0-9._-]+/g, '-');
}

function availableManagedDestination(managedRoot, repository) {
  const base = managedDirectoryName(repository);
  for (let index = 1; index <= 1000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidate = path.join(managedRoot, `${base}${suffix}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('No safe managed repository destination is available.');
}

function cloneUrl(repository) {
  const target = repositoryIdentity(repository);
  if (repository?.url) return String(repository.url);
  return `https://${target.host}/${target.owner}/${target.name}.git`;
}

export function cloneManagedRepository(repository, baseBranch, {
  managedRoot = managedRepositoriesRoot(),
  runner = defaultRun,
  remoteProbe = null,
  markerWriter = writeFileSync,
} = {}) {
  mkdirSync(managedRoot, { recursive: true });
  const destination = availableManagedDestination(managedRoot, repository);
  const partial = `${destination}.partial-${randomUUID()}`;
  const marker = `${partial}.incomplete`;
  markerWriter(marker, 'Clone is incomplete and must not be used as a checkout.\n', 'utf8');

  const result = runner('git', [
    'clone', '--origin', 'origin', '--branch', String(baseBranch), '--single-branch', cloneUrl(repository), partial,
  ], { allowFailure: true });
  if (!result?.ok) {
    return {
      ok: false,
      destination,
      partial,
      marker,
      blocker: { code: 'checkout-clone-failed', message: 'Repository clone did not complete.', recoveryAction: 'Retry cloning. The incomplete directory is not considered a valid checkout.' },
    };
  }

  const validation = validateCheckoutCandidate(partial, repository, baseBranch, { runner, remoteProbe });
  if (!validation.valid) {
    return {
      ok: false,
      destination,
      partial,
      marker,
      validation,
      blocker: { code: 'checkout-clone-invalid', message: 'The completed clone did not pass checkout validation.', recoveryAction: 'Inspect the technical details and retry with a new managed checkout.' },
    };
  }

  renameSync(partial, destination);
  rmSync(marker, { force: true });
  return {
    ok: true,
    destination,
    partial: null,
    marker: null,
    checkout: { ...validation, path: destination, root: destination, managed: true },
    blocker: null,
  };
}

export function discoverRepositoryCheckouts(repository, baseBranch, {
  registeredRepositories = null,
  paseoWorkspaces = [],
  managedRoot = managedRepositoriesRoot(),
  runner = defaultRun,
  remoteProbe = null,
  registryOptions = {},
} = {}) {
  const registered = registeredRepositories || listRepositories(registryOptions);
  const paths = repositoryCheckoutCandidatePaths({ registeredRepositories: registered, paseoWorkspaces, managedRoot });
  const candidates = paths.map((candidatePath) => {
    const candidate = validateCheckoutCandidate(candidatePath, repository, baseBranch, { runner, remoteProbe });
    return { ...candidate, managed: candidatePath.startsWith(path.resolve(managedRoot) + path.sep) || candidatePath === path.resolve(managedRoot) };
  });
  const valid = candidates.filter((candidate) => candidate.valid);
  return { candidates, valid, searchedPaths: paths };
}

export function ensureRepositoryCheckout(repository, baseBranch, {
  registeredRepositories = null,
  paseoWorkspaces = [],
  managedRoot = managedRepositoriesRoot(),
  runner = defaultRun,
  remoteProbe = null,
  registryOptions = {},
  register = (checkoutPath) => addRepository(checkoutPath, { ...registryOptions, runner }),
} = {}) {
  const discovery = discoverRepositoryCheckouts(repository, baseBranch, {
    registeredRepositories,
    paseoWorkspaces,
    managedRoot,
    runner,
    remoteProbe,
    registryOptions,
  });
  if (discovery.valid.length === 1) {
    const selected = discovery.valid[0];
    const registration = register(selected.path);
    return { status: 'selected', checkout: selected, registration, candidates: discovery.candidates, blocker: null };
  }
  if (discovery.valid.length > 1) {
    return {
      status: 'choice-required',
      checkout: null,
      registration: null,
      candidates: discovery.candidates,
      choices: discovery.valid.map((candidate) => ({ path: candidate.path, managed: candidate.managed, safe: candidate.safe, reasons: candidate.reasons })),
      blocker: { code: 'checkout-choice-required', message: 'Multiple safe checkouts match this repository.', recoveryAction: 'Choose the checkout Paseo should manage.' },
    };
  }

  const cloned = cloneManagedRepository(repository, baseBranch, { managedRoot, runner, remoteProbe });
  if (!cloned.ok) {
    return { status: 'blocked', checkout: null, registration: null, candidates: discovery.candidates, blocker: cloned.blocker, clone: cloned };
  }
  const registration = register(cloned.checkout.path);
  return { status: 'cloned', checkout: cloned.checkout, registration, candidates: discovery.candidates, blocker: null };
}
