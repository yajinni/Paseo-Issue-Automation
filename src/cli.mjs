import { automationStatus, heartbeat, markHumanReview, recordEvent, setClaimsEnabled, terminalState } from './automation.mjs';
import { abandonAttempt, openAttemptWorkspace, operationalStatus, skipIssue, unskipIssue } from './attempts.mjs';
import { dispatchSpecificCodingIssue, restartCodingIssue } from './coding-dispatch.mjs';
import { retryFixJob } from './fix-jobs.mjs';
import { setupSnapshot } from './install.mjs';
import { repositoryRoot } from './state.mjs';
import { startServer } from './server.mjs';
import { runBrowserCommand } from './browser-cli.mjs';
import { prReviewStatus } from './pr-review-status.mjs';
import { reconcileManagedPullRequests, recoverPrReviewState } from './pr-review-reconcile.mjs';
import { dispatchAvailableIssues } from './dispatch-batch.mjs';
import {
  applyManualReviewResult,
  cancelQueuedReview,
  enqueueManagedReview,
  moveReviewJob,
  pauseManagedPr,
  retryReviewJob,
} from './pr-review-queue.mjs';
import { setReviewQueuePaused } from './pr-review-store.mjs';
import { saveValidatedPrAutomationConfig } from './pr-review-config.mjs';
import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';
import { importManagedPullRequest } from './pr-review-import.mjs';

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

PR review commands:
  pr-review status
  pr-review enable | disable
  pr-review pause | resume
  pr-review reconcile | recover
  pr-review import | register --id REPOSITORY#PR [--issue N] [--head SHA]
  pr-review review-now --id REPOSITORY#PR [--url CHATGPT_CONVERSATION_URL]
  pr-review retry --job REVIEW_JOB_ID
  pr-review retry-fix --job FIX_JOB_ID
  pr-review move --job REVIEW_JOB_ID --direction up|down
  pr-review pause-pr --id REPOSITORY#PR | resume-pr --id REPOSITORY#PR
  pr-review cancel --job REVIEW_JOB_ID
  pr-review manual-result --id REPOSITORY#PR --result approved|changes_requested [--findings TEXT]
  pr-review dispatch-fix

Browser commands:
  browser setup [--scope project|global] [--url URL] [--deps] [--send]
  browser install [--deps]
  browser login
  browser configure [--scope project|global] [--url URL]
  browser doctor
  browser test [--url URL] [--visible] [--send]
  browser debug [--url URL]
  browser reset
  browser uninstall
`);
}

export async function prReviewCommand(root, options, services = {}) {
  const action = options._[1] || 'status';
  if (action === 'status') return prReviewStatus(root);
  if (action === 'enable') return saveValidatedPrAutomationConfig(root, { enabled: true, browserReview: { enabled: true } });
  if (action === 'disable') return saveValidatedPrAutomationConfig(root, { enabled: false });
  if (action === 'pause') return setReviewQueuePaused(root, true);
  if (action === 'resume') return setReviewQueuePaused(root, false);
  if (action === 'reconcile') return reconcileManagedPullRequests(root);
  if (action === 'recover') return recoverPrReviewState(root);
  if (action === 'import' || action === 'register') return (services.importer || importManagedPullRequest)(root, {
    id: required(options, 'id'),
    issueNumber: options.issue,
    headSha: options.head,
  });
  if (action === 'review-now') return enqueueManagedReview(root, required(options, 'id'), {
    immediate: true,
    conversationUrlOverride: options.url ? normalizeChatGptConversationUrl(options.url) : null,
  });
  if (action === 'retry') return retryReviewJob(root, required(options, 'job'));
  if (action === 'retry-fix') return retryFixJob(root, required(options, 'job'));
  if (action === 'move') return moveReviewJob(root, required(options, 'job'), required(options, 'direction'));
  if (action === 'pause-pr') return pauseManagedPr(root, required(options, 'id'), true);
  if (action === 'resume-pr') return pauseManagedPr(root, required(options, 'id'), false);
  if (action === 'cancel') return cancelQueuedReview(root, required(options, 'job'));
  if (action === 'manual-result') return applyManualReviewResult(root, required(options, 'id'), { result: required(options, 'result'), findings: options.findings || '' });
  if (action === 'dispatch-fix') return dispatchAvailableIssues(root);
  throw new Error(`Unknown pr-review command: ${action}`);
}

export async function main(argv) {
  const options = argsToObject(argv);
  const command = options._[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') { help(); return; }
  if (command === 'setup') { await startServer({ open: true, initialView: 'settings' }); return; }
  if (command === 'start') { await startServer({ open: false }); return; }

  const root = repositoryRoot();
  if (command === 'browser') {
    const result = await runBrowserCommand(root, options._[1] || 'doctor', {
      scope: options.scope,
      url: options.url,
      deps: options.deps === true,
      send: options.send === true,
      visible: options.visible === true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'pr-review') {
    console.log(JSON.stringify(await prReviewCommand(root, options), null, 2));
    return;
  }
  if (command === 'status') console.log(JSON.stringify({ setup: setupSnapshot(root), automation: { ...automationStatus(root), ...operationalStatus(root) }, prReviews: prReviewStatus(root) }, null, 2));
  else if (command === 'enable') console.log(JSON.stringify(setClaimsEnabled(root, true), null, 2));
  else if (command === 'disable') console.log(JSON.stringify(setClaimsEnabled(root, false), null, 2));
  else if (command === 'start-issue') console.log(JSON.stringify(dispatchSpecificCodingIssue(root, issueNumber(options), { branchAction: options['branch-action'] || 'keep' }), null, 2));
  else if (command === 'skip-issue') console.log(JSON.stringify(skipIssue(root, issueNumber(options)), null, 2));
  else if (command === 'unskip-issue') console.log(JSON.stringify(unskipIssue(root, issueNumber(options)), null, 2));
  else if (command === 'abandon') console.log(JSON.stringify(abandonAttempt(root, issueNumber(options), options.reason || 'Abandoned by user'), null, 2));
  else if (command === 'restart') console.log(JSON.stringify(restartCodingIssue(root, issueNumber(options), { branchAction: options['branch-action'] || 'keep' }), null, 2));
  else if (command === 'open-workspace') console.log(JSON.stringify(openAttemptWorkspace(root, issueNumber(options)), null, 2));
  else if (command === 'record') console.log(JSON.stringify(recordEvent(root, issueNumber(options), {
    event: required(options, 'event'), result: required(options, 'result'), commit: required(options, 'commit'), details: options.details || '',
  }), null, 2));
  else if (command === 'heartbeat') console.log(JSON.stringify(heartbeat(root, issueNumber(options), required(options, 'phase')), null, 2));
  else if (command === 'human-review') console.log(JSON.stringify(markHumanReview(root, issueNumber(options), Number(required(options, 'pr'))), null, 2));
  else if (command === 'block' || command === 'fail') console.log(JSON.stringify(terminalState(root, issueNumber(options), command === 'block' ? 'blocked' : 'failed', required(options, 'reason')), null, 2));
  else throw new Error(`Unknown command: ${command}`);
}
