import { setTimeout as sleep } from 'node:timers/promises';
import {
  REVIEW_OUTPUT_SCHEMA,
  buildBaseUpdatePrompt,
  buildCompletionRecoveryPrompt,
  buildRepairPrompt,
  buildReviewerPrompt,
} from './controller-prompts.mjs';
import { markHumanReview, recordEvent, terminalState } from './automation.mjs';
import { postReviewerAuditComment } from './reviewer-audit.mjs';
import { handoffValidatedPullRequest, prReviewAutomationEnabled } from './pr-review-handoff.mjs';
import { loadConfig, loadRun, saveRun } from './state.mjs';
import { agentCommandTimeoutMs, run, runJson } from './process.mjs';

const CHECK_POLL_MS = 15_000;
const MAX_CHECK_POLLS = 120;
const MAX_COMPLETION_RECOVERY_ATTEMPTS = 1;

function updateState(root, issueNumber, patch, activity = null) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const at = new Date().toISOString();
  return saveRun(root, issueNumber, {
    ...state,
    ...patch,
    updatedAt: at,
    heartbeatAt: at,
    activity: activity
      ? [...(state.activity || []), { type: activity.type, at, details: activity.details || '' }]
      : state.activity || [],
  });
}

function waitForCoder(root, state) {
  const agentId = state.coderAgentId || state.agentId;
  if (!agentId) throw new Error('Coder agent ID is missing.');
  const result = run('paseo', ['wait', String(agentId)], {
    cwd: root,
    allowFailure: true,
    inherit: true,
    timeoutMs: agentCommandTimeoutMs(),
  });
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Paseo could not wait for the Coder.');
}

function sendCoder(root, state, prompt) {
  const agentId = state.coderAgentId || state.agentId;
  const sent = run('paseo', ['send', String(agentId), '--no-wait', prompt], { cwd: root, allowFailure: true });
  if (!sent.ok) throw new Error(sent.stderr || sent.stdout || 'Paseo could not send the repair task to the Coder.');
  waitForCoder(root, state);
}

function latestValidation(state) {
  return [...(state.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary' && event.result === 'PASS' && event.commit);
}

function currentPr(root, state) {
  const prs = runJson('gh', [
    'pr', 'list', '--state', 'open', '--head', state.branch, '--limit', '10',
    '--json', 'number,url,isDraft,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,statusCheckRollup',
  ], { cwd: root, allowFailure: true }) || [];
  return prs.find((pr) => pr.baseRefName === loadConfig(root).baseBranch) || prs[0] || null;
}

function worktreeHead(root, state) {
  const cwd = state.worktreePath || root;
  const result = run('git', ['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  return result.ok ? result.stdout : null;
}

function completionEvidenceError(message) {
  const error = new Error(message);
  error.code = 'CODER_COMPLETION_EVIDENCE_INCOMPLETE';
  return error;
}

function requireValidatedPr(root, issueNumber) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  if (state.status !== 'agent-running') return { terminal: true, state };
  const validation = latestValidation(state);
  if (!validation) throw completionEvidenceError('Coder finished without recording a passing validation-summary event.');
  const pr = currentPr(root, state);
  if (!pr) throw completionEvidenceError(`Coder finished without an open pull request for ${state.branch}.`);
  const head = worktreeHead(root, state);
  if (!head || head !== pr.headRefOid || validation.commit !== pr.headRefOid) {
    throw completionEvidenceError('Validation, worktree HEAD, and pull-request HEAD do not identify the same exact commit.');
  }
  return { terminal: false, state, validation, pr, head };
}

function requireValidatedPrWithRecovery(root, issueNumber, recovery) {
  try {
    return requireValidatedPr(root, issueNumber);
  } catch (error) {
    if (error?.code !== 'CODER_COMPLETION_EVIDENCE_INCOMPLETE'
        || recovery.attempts >= MAX_COMPLETION_RECOVERY_ATTEMPTS) {
      throw error;
    }
    const state = loadRun(root, issueNumber);
    if (!state || state.status !== 'agent-running') throw error;
    recovery.attempts += 1;
    const reason = String(error.message || error);
    updateState(root, issueNumber, { phase: 'recovering-completion-evidence', reason }, {
      type: 'completion-evidence-recovery',
      details: `Coder completion evidence was incomplete; recovery attempt ${recovery.attempts}/${MAX_COMPLETION_RECOVERY_ATTEMPTS}: ${reason}`,
    });
    sendCoder(root, state, buildCompletionRecoveryPrompt({
      issueNumber,
      branch: state.branch,
      baseBranch: loadConfig(root).baseBranch,
      reason,
    }));
    return requireValidatedPr(root, issueNumber);
  }
}

function runReviewer(root, issueNumber, snapshot, reviewRound) {
  const config = loadConfig(root);
  const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
  const issue = runJson('gh', [
    'issue', 'view', String(issueNumber), '--json', 'number,title,body,url,comments,blockedBy,blocking',
  ], { cwd: root });
  if (!repository || !issue) throw new Error('Could not load repository or issue context for review.');
  updateState(root, issueNumber, { phase: 'reviewing', prNumber: snapshot.pr.number, prUrl: snapshot.pr.url }, {
    type: 'review-started',
    details: `Fresh review for ${snapshot.head}.`,
  });
  const verdict = runJson('paseo', [
    'run', '--provider', config.models.reviewer,
    '--workspace', String(snapshot.state.workspaceId),
    '--title', `Issue #${issueNumber} Reviewer`,
    '--output-schema', REVIEW_OUTPUT_SCHEMA,
    buildReviewerPrompt({
      repository,
      issue,
      branch: snapshot.state.branch,
      commit: snapshot.head,
      config,
    }),
  ], { cwd: root, timeoutMs: agentCommandTimeoutMs() });
  if (!verdict || typeof verdict.approved !== 'boolean') throw new Error('Reviewer did not return the required structured verdict.');
  recordEvent(root, issueNumber, {
    event: 'review',
    result: verdict.approved ? 'APPROVED' : 'CHANGES_REQUIRED',
    commit: snapshot.head,
    details: String(verdict.findings || ''),
  });
  const audit = postReviewerAuditComment(root, {
    issueNumber,
    prNumber: snapshot.pr.number,
    commit: snapshot.head,
    round: reviewRound,
    approved: verdict.approved,
    findings: verdict.findings,
  });
  updateState(root, issueNumber, {}, {
    type: 'review-audit-posted',
    details: `Posted ${audit.verdict} for ${audit.commit} to PR #${audit.prNumber} (round ${audit.round}).`,
  });
  return verdict;
}

function branchContainsLatestBase(root, state, baseBranch) {
  const cwd = state.worktreePath || root;
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const fetch = run('git', ['fetch', '--prune', 'origin', `${baseBranch}:${remoteRef}`], {
    cwd,
    allowFailure: true,
  });
  if (!fetch.ok) return { ok: false, reason: fetch.stderr || fetch.stdout || `Could not fetch ${baseBranch}.` };
  const contains = run('git', ['merge-base', '--is-ancestor', remoteRef, 'HEAD'], { cwd, allowFailure: true }).ok;
  return contains
    ? { ok: true }
    : { ok: false, reason: `The issue branch does not contain the latest ${baseBranch}.` };
}

function checksState(pr) {
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const states = checks.map((check) => String(check.conclusion || check.state || check.status || '').toUpperCase());
  const failed = states.some((state) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state));
  const pending = states.some((state) => !state || ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING'].includes(state));
  return { failed, pending, checks };
}

async function waitForChecks(root, state) {
  for (let poll = 0; poll < MAX_CHECK_POLLS; poll += 1) {
    const pr = currentPr(root, state);
    if (!pr) throw new Error('The draft pull request disappeared while waiting for checks.');
    const status = checksState(pr);
    if (status.failed) return { state: 'failed', pr, checks: status.checks };
    if (!status.pending) return { state: 'passed', pr, checks: status.checks };
    updateState(root, state.issueNumber, { phase: 'waiting-for-ci' });
    await sleep(CHECK_POLL_MS);
  }
  return { state: 'timeout', pr: currentPr(root, state), checks: [] };
}

function checkFailureDetails(checks) {
  return checks.map((check) => {
    const name = check.name || check.context || check.workflowName || 'check';
    const state = check.conclusion || check.state || check.status || 'unknown';
    return `${name}: ${state}`;
  }).join('\n');
}

function handoffToSerialReview(root, issueNumber, snapshot) {
  const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
  const issue = runJson('gh', [
    'issue', 'view', String(issueNumber), '--json', 'number,title,body,url,comments,blockedBy,blocking',
  ], { cwd: root });
  if (!repository || !issue) throw new Error('Could not load repository or issue context for PR-review handoff.');
  return handoffValidatedPullRequest(root, {
    repository,
    issue,
    state: snapshot.state,
    pr: snapshot.pr,
    headSha: snapshot.head,
  });
}

async function execute(root, issueNumber) {
  const config = loadConfig(root);
  let repairCycles = 0;
  let completedReviews = 0;
  const completionRecovery = { attempts: 0 };

  waitForCoder(root, loadRun(root, issueNumber));

  while (repairCycles <= config.maxReviewRounds + 4) {
    const snapshot = requireValidatedPrWithRecovery(root, issueNumber, completionRecovery);
    if (snapshot.terminal) return;

    const freshness = branchContainsLatestBase(root, snapshot.state, config.baseBranch);
    const conflicting = snapshot.pr.mergeable === 'CONFLICTING' || snapshot.pr.mergeStateStatus === 'DIRTY';
    if (!freshness.ok || conflicting) {
      const reason = conflicting ? 'GitHub reports merge conflicts with the current base branch.' : freshness.reason;
      updateState(root, issueNumber, { phase: 'updating-from-base' }, { type: 'base-update-required', details: reason });
      sendCoder(root, snapshot.state, buildBaseUpdatePrompt({ issueNumber, baseBranch: config.baseBranch, reason }));
      repairCycles += 1;
      continue;
    }

    if (prReviewAutomationEnabled(root)) {
      handoffToSerialReview(root, issueNumber, snapshot);
      return;
    }

    if (completedReviews >= config.maxReviewRounds) {
      throw new Error(`Maximum review rounds (${config.maxReviewRounds}) reached.`);
    }
    const verdict = runReviewer(root, issueNumber, snapshot, completedReviews + 1);
    completedReviews += 1;
    if (!verdict.approved) {
      updateState(root, issueNumber, { phase: 'repairing' }, { type: 'review-changes-required', details: verdict.findings });
      sendCoder(root, snapshot.state, buildRepairPrompt({ issueNumber, findings: verdict.findings }));
      repairCycles += 1;
      continue;
    }

    const afterReview = requireValidatedPrWithRecovery(root, issueNumber, completionRecovery);
    if (afterReview.head !== snapshot.head) continue;
    const postReviewFreshness = branchContainsLatestBase(root, afterReview.state, config.baseBranch);
    if (!postReviewFreshness.ok) {
      sendCoder(root, afterReview.state, buildBaseUpdatePrompt({
        issueNumber,
        baseBranch: config.baseBranch,
        reason: postReviewFreshness.reason,
      }));
      repairCycles += 1;
      continue;
    }

    const ci = await waitForChecks(root, afterReview.state);
    if (ci.state === 'failed') {
      const details = checkFailureDetails(ci.checks);
      updateState(root, issueNumber, { phase: 'repairing' }, { type: 'ci-failed', details });
      sendCoder(root, afterReview.state, buildRepairPrompt({
        issueNumber,
        findings: `GitHub checks failed on the reviewed commit:\n${details}\nDiagnose code-related failures. Block instead of guessing if the failure is external infrastructure.`,
      }));
      repairCycles += 1;
      continue;
    }
    if (ci.state === 'timeout') throw new Error('Timed out waiting for GitHub checks to finish.');

    const finalSnapshot = requireValidatedPrWithRecovery(root, issueNumber, completionRecovery);
    if (finalSnapshot.terminal) return;
    if (finalSnapshot.head !== afterReview.head) continue;
    const finalFreshness = branchContainsLatestBase(root, finalSnapshot.state, config.baseBranch);
    const finalConflict = finalSnapshot.pr.mergeable === 'CONFLICTING' || finalSnapshot.pr.mergeStateStatus === 'DIRTY';
    if (!finalFreshness.ok || finalConflict) {
      const reason = finalConflict
        ? 'GitHub reports merge conflicts after CI completed.'
        : finalFreshness.reason;
      sendCoder(root, finalSnapshot.state, buildBaseUpdatePrompt({
        issueNumber,
        baseBranch: config.baseBranch,
        reason,
      }));
      repairCycles += 1;
      continue;
    }

    updateState(root, issueNumber, { phase: 'finalizing-human-review' });
    markHumanReview(root, issueNumber, finalSnapshot.pr.number);
    return;
  }
  throw new Error('Maximum controller repair cycles reached.');
}

async function main() {
  const [root, rawIssue] = process.argv.slice(2);
  const issueNumber = Number(rawIssue);
  if (!root || !Number.isInteger(issueNumber)) throw new Error('Usage: controller-worker.mjs <repository-root> <issue-number>');
  try {
    await execute(root, issueNumber);
  } catch (error) {
    const state = loadRun(root, issueNumber);
    if (state?.status === 'agent-running') {
      terminalState(root, issueNumber, 'failed', error.message);
    }
    process.exitCode = 1;
  }
}

await main();
