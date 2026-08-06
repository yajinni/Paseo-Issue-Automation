import path from 'node:path';
import { main } from './cli.mjs';
import { startManagerServer } from './manager-server.mjs';
import { runRepositoryCommand } from './repository-command.mjs';
import { resolveRepositoryInvocation } from './repository-context.mjs';
import { printTopLevelHelp } from './top-level-help.mjs';

export async function dispatchCli(args = [], {
  cwd = process.cwd(),
  mainCommand = main,
  managerCommand = startManagerServer,
  repositoryCommand = runRepositoryCommand,
  helpCommand = printTopLevelHelp,
  changeDirectory = process.chdir,
  rootDir,
  runner,
  platform = process.platform,
} = {}) {
  if (args.length === 0) return managerCommand({ open: true, rootDir });

  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') return helpCommand();
  if (command === 'repo') return repositoryCommand(args.slice(1), { cwd, rootDir, runner, platform });
  if (command === 'manager') {
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
