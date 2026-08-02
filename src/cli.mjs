import { automationStatus, heartbeat, markHumanReview, recordEvent, setClaimsEnabled, terminalState } from './automation.mjs';
import { setupSnapshot } from './install.mjs';
import { repositoryRoot } from './state.mjs';
import { startServer } from './server.mjs';

function argsToObject(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function required(options, name) {
  const value = options[name];
  if (value === undefined || value === true || value === '') throw new Error(`--${name} is required.`);
  return value;
}

function help() {
  console.log(`Paseo Issue Automation

Commands:
  setup                      Open the guided setup dashboard
  start                      Start the dashboard and polling controller
  status                     Print current setup and automation status
  enable                     Resume new issue claims
  disable                    Pause new issue claims
  record --issue N --event NAME --result VALUE --commit SHA [--details TEXT]
  heartbeat --issue N --phase NAME
  human-review --issue N --pr N
  block --issue N --reason TEXT
  fail --issue N --reason TEXT
`);
}

export async function main(argv) {
  const options = argsToObject(argv);
  const command = options._[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }
  if (command === 'setup') {
    await startServer({ open: true });
    return;
  }
  if (command === 'start') {
    await startServer({ open: false });
    return;
  }

  const root = repositoryRoot();
  if (command === 'status') {
    console.log(JSON.stringify({ setup: setupSnapshot(root), automation: automationStatus(root) }, null, 2));
    return;
  }
  if (command === 'enable') {
    console.log(JSON.stringify(setClaimsEnabled(root, true), null, 2));
    return;
  }
  if (command === 'disable') {
    console.log(JSON.stringify(setClaimsEnabled(root, false), null, 2));
    return;
  }
  if (command === 'record') {
    const issue = Number(required(options, 'issue'));
    const event = required(options, 'event');
    const result = required(options, 'result');
    const commit = required(options, 'commit');
    console.log(JSON.stringify(recordEvent(root, issue, {
      event,
      result,
      commit,
      details: options.details || '',
    }), null, 2));
    return;
  }
  if (command === 'heartbeat') {
    console.log(JSON.stringify(heartbeat(root, Number(required(options, 'issue')), required(options, 'phase')), null, 2));
    return;
  }
  if (command === 'human-review') {
    console.log(JSON.stringify(markHumanReview(root, Number(required(options, 'issue')), Number(required(options, 'pr'))), null, 2));
    return;
  }
  if (command === 'block' || command === 'fail') {
    console.log(JSON.stringify(terminalState(
      root,
      Number(required(options, 'issue')),
      command === 'block' ? 'blocked' : 'failed',
      required(options, 'reason'),
    ), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
