import path from 'node:path';
import { findRepository, inspectRepository } from './repository-registry.mjs';

function normalizedPath(value, platform = process.platform) {
  const resolved = path.resolve(String(value || '').trim());
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function extractRepositoryOption(args = []) {
  const remaining = [];
  let selector = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--repo') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--repo requires a repository ID, GitHub name, or path.');
      if (selector !== null) throw new Error('--repo may be supplied only once.');
      selector = next;
      index += 1;
      continue;
    }
    if (value.startsWith('--repo=')) {
      if (selector !== null) throw new Error('--repo may be supplied only once.');
      selector = value.slice('--repo='.length).trim();
      if (!selector) throw new Error('--repo requires a repository ID, GitHub name, or path.');
      continue;
    }
    remaining.push(value);
  }
  return { selector, args: remaining };
}

export function resolveRepositoryInvocation(args = [], {
  cwd = process.cwd(),
  rootDir,
  runner,
  platform = process.platform,
} = {}) {
  const extracted = extractRepositoryOption(args);
  if (extracted.selector) {
    const registered = findRepository(extracted.selector, { rootDir, platform });
    if (!registered) {
      throw new Error(
        `Repository ${extracted.selector} is not registered. Run paseo-issue-automation repo add PATH first.`,
      );
    }
    const inspected = inspectRepository(registered.path, { runner, platform });
    if (normalizedPath(inspected.path, platform) !== normalizedPath(registered.path, platform)) {
      throw new Error(
        `Registered path ${registered.path} now resolves to a different Git repository root: ${inspected.path}.`,
      );
    }
    return {
      args: extracted.args,
      context: {
        ...registered,
        path: inspected.path,
        remote: inspected.remote,
        repository: inspected.repository || registered.repository,
        source: 'registry',
      },
    };
  }

  const inspected = inspectRepository(cwd, { runner, platform });
  const registered = findRepository(inspected.path, { rootDir, platform });
  return {
    args: extracted.args,
    context: {
      ...inspected,
      ...(registered || {}),
      path: inspected.path,
      remote: inspected.remote,
      repository: inspected.repository || registered?.repository || null,
      source: 'cwd',
      registered: Boolean(registered),
    },
  };
}
