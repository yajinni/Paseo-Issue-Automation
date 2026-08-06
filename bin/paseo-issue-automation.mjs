#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { runRepositoryCommand } from '../src/repository-command.mjs';

const args = process.argv.slice(2);
const operation = args[0] === 'repo'
  ? Promise.resolve(runRepositoryCommand(args.slice(1)))
  : main(args);

operation.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
