import path from 'node:path';
import { main } from './cli.mjs';
import { startManagerServer } from './manager-server.mjs';
import { runRepositoryCommand } from './repository-command.mjs';
import { resolveRepositoryInvocation } from './repository-context.mjs';
import { printTopLevelHelp } from './top-level-help.mjs';

function retiredTopLevelCommand(command) {
  if (command === 'help' || command === '-h') {
    throw new Error(`Unknown command: ${command}. Use paseo-issue-automation --help.`);
  }
  if (command === 'manager') {
    throw new Error('Unknown command: manager. Run paseo-issue-automation with no arguments to open the manager.');
  }
}

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
  if (command === '--help') {
    if (args.length !== 1) throw new Error('paseo-issue-automation --help does not accept additional arguments.');
    return helpCommand();
  }
  retiredTopLevelCommand(command);
  if (command === 'repo') return repositoryCommand(args.slice(1), { cwd, rootDir, runner, platform });

  const invocation = resolveRepositoryInvocation(args, { cwd, rootDir, runner, platform });
  if (path.resolve(cwd) !== path.resolve(invocation.context.path)) {
    changeDirectory(invocation.context.path);
  }
  return mainCommand(invocation.args);
}
