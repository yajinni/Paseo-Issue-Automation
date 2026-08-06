import path from 'node:path';
import { main } from './cli.mjs';
import { startManagerServer } from './manager-server.mjs';
import { runRepositoryCommand } from './repository-command.mjs';
import { resolveRepositoryInvocation } from './repository-context.mjs';

export async function dispatchCli(args = [], {
  cwd = process.cwd(),
  mainCommand = main,
  managerCommand = startManagerServer,
  repositoryCommand = runRepositoryCommand,
  changeDirectory = process.chdir,
  rootDir,
  runner,
  platform = process.platform,
} = {}) {
  if (args[0] === 'repo') return repositoryCommand(args.slice(1), { cwd, rootDir, runner, platform });
  if (args[0] === 'manager') {
    const unknown = args.slice(1).filter((value) => value !== '--open');
    if (unknown.length) throw new Error(`Unknown manager option: ${unknown[0]}`);
    return managerCommand({ open: args.includes('--open'), rootDir });
  }
  const invocation = resolveRepositoryInvocation(args, { cwd, rootDir, runner, platform });
  if (path.resolve(cwd) !== path.resolve(invocation.context.path)) {
    changeDirectory(invocation.context.path);
  }
  return mainCommand(invocation.args);
}
