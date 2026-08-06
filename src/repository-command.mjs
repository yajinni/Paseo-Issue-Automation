import {
  addRepository,
  findRepository,
  listRepositories,
  removeRepository,
} from './repository-registry.mjs';

function required(value, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

export function repositoryCommandResult(args = [], {
  cwd = process.cwd(),
  rootDir,
  runner,
  now,
  platform,
} = {}) {
  const action = args[0] || 'list';
  const options = { rootDir, runner, now, platform };
  if (action === 'list') {
    return { action, repositories: listRepositories(options) };
  }
  if (action === 'add') {
    const repository = addRepository(args[1] || cwd, options);
    return { action, repository };
  }
  if (action === 'show') {
    const selector = required(args[1], 'Repository ID, GitHub name, or path is required.');
    const repository = findRepository(selector, options);
    if (!repository) throw new Error(`Repository ${selector} is not registered.`);
    return { action, repository };
  }
  if (action === 'remove') {
    const selector = required(args[1], 'Repository ID, GitHub name, or path is required.');
    const result = removeRepository(selector, options);
    if (!result.removed) throw new Error(`Repository ${selector} is not registered.`);
    return { action, repository: result.repository };
  }
  if (action === 'help' || action === '--help' || action === '-h') {
    return {
      action: 'help',
      usage: [
        'paseo-issue-automation repo list',
        'paseo-issue-automation repo add [PATH]',
        'paseo-issue-automation repo show ID|OWNER/REPO|PATH',
        'paseo-issue-automation repo remove ID|OWNER/REPO|PATH',
      ],
    };
  }
  throw new Error(`Unknown repository command: ${action}`);
}

export function runRepositoryCommand(args = [], options = {}) {
  const result = repositoryCommandResult(args, options);
  (options.write || console.log)(JSON.stringify(result, null, 2));
  return result;
}
