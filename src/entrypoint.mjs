import path from 'node:path';
import { main } from './cli.mjs';
import { runRepositoryCommand } from './repository-command.mjs';
import { resolveRepositoryInvocation } from './repository-context.mjs';

export async function dispatchCli(args = [], {
  cwd = process.cwd(),
  mainCommand = main,
  repositoryCommand = runRepositoryCommand,
  changeDirectory = process.chdir,
  rootDir,
  runner,
  platform = process.platform,
} = {}) {
  if (args[0] === 'repo') return repositoryCommand(args.slice(1), { cwd, rootDir, runner, platform });
  const invocation = resolveRepositoryInvocation(args, { cwd, rootDir, runner, platform });
  if (path.resolve(cwd) !== path.resolve(invocation.context.path)) {
    changeDirectory(invocation.context.path);
  }
  return mainCommand(invocation.args);
}
