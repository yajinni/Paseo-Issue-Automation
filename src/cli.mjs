import { automationStatus, heartbeat, markHumanReview, recordEvent, setClaimsEnabled, terminalState } from './automation.mjs';
import { abandonAttempt, dispatchSpecificIssue, openAttemptWorkspace, operationalStatus, restartIssue, skipIssue, unskipIssue } from './attempts.mjs';
import { setupSnapshot } from './install.mjs';
import { repositoryRoot } from './state.mjs';
import { startServer } from './server.mjs';

function argsToObject(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) { result._.push(value); continue; }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) { result[key] = next; index += 1; }
    else result[key] = true;
  }
  return result;
}

function required(options, name) {
  const value = options[name];
  if (value === undefined || value === true || value === '') throw new Error(`--${name} is required.`);
  return value;
}

function issueNumber(options) { return Number(required(options, 'issue')); }

function help() {
  console.log(`Paseo Issue Automation

Commands:
  setup
  start
  status
  enable | disable
  start-issue --issue N [--branch-action keep|delete]
  skip-issue --issue N | unskip-issue --issue N
  abandon --issue N [--reason TEXT]
  restart --issue N [--branch-action keep|delete]
  open-workspace --issue N
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
  if (command === 'help' || command === '--help' || command === '-h') { help(); return; }
  if (command === 'setup') { await startServer({ open: true }); return; }
  if (command === 'start') { await startServer({ open: false }); return; }

  const root = repositoryRoot();
  if (command === 'status') console.log(JSON.stringify({ setup: setupSnapshot(root), automation: { ...automationStatus(root), ...operationalStatus(root) } }, null, 2));
  else if (command === 'enable') console.log(JSON.stringify(setClaimsEnabled(root, true), null, 2));
  else if (command === 'disable') console.log(JSON.stringify(setClaimsEnabled(root, false), null, 2));
  else if (command === 'start-issue') console.log(JSON.stringify(dispatchSpecificIssue(root, issueNumber(options), { branchAction: options['branch-action'] || 'keep' }), null, 2));
  else if (command === 'skip-issue') console.log(JSON.stringify(skipIssue(root, issueNumber(options)), null, 2));
  else if (command === 'unskip-issue') console.log(JSON.stringify(unskipIssue(root, issueNumber(options)), null, 2));
  else if (command === 'abandon') console.log(JSON.stringify(abandonAttempt(root, issueNumber(options), options.reason || 'Abandoned by user'), null, 2));
  else if (command === 'restart') console.log(JSON.stringify(restartIssue(root, issueNumber(options), { branchAction: options['branch-action'] || 'keep' }), null, 2));
  else if (command === 'open-workspace') console.log(JSON.stringify(openAttemptWorkspace(root, issueNumber(options)), null, 2));
  else if (command === 'record') console.log(JSON.stringify(recordEvent(root, issueNumber(options), {
    event: required(options, 'event'), result: required(options, 'result'), commit: required(options, 'commit'), details: options.details || '',
  }), null, 2));
  else if (command === 'heartbeat') console.log(JSON.stringify(heartbeat(root, issueNumber(options), required(options, 'phase')), null, 2));
  else if (command === 'human-review') console.log(JSON.stringify(markHumanReview(root, issueNumber(options), Number(required(options, 'pr'))), null, 2));
  else if (command === 'block' || command === 'fail') console.log(JSON.stringify(terminalState(root, issueNumber(options), command === 'block' ? 'blocked' : 'failed', required(options, 'reason')), null, 2));
  else throw new Error(`Unknown command: ${command}`);
}
