import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildBaseUpdatePrompt,
  buildCompletionRecoveryPrompt,
  buildRepairPrompt,
} from './controller-prompts.mjs';
import {
  configuredReviewRound,
  enterConfiguredQuickHandoff,
  markReviewNeedsAttention,
  reviewRepairInstructions,
  runConfiguredHarnessReview,
} from './controller-review-workflow.mjs';
import { finalizeApprovedPullRequest } from './approved-pr-finalization.mjs';
import { recordEvent, terminalState } from './automation.mjs';
import { inspectBaseFreshness } from './base-freshness.mjs';
import {
  currentPr,
  ensureDraftPr,
  refreshControllerDraftPrHandoff,
} from './controller-draft-pr.mjs';
import {
  reviewRequestIdentity,
  runStructuredReviewWithRetry,
} from './review-output-retry.mjs';
import { appendIssueLifecycle, loadConfig, loadRun, saveRun } from './state.mjs';
import { agentCommandTimeoutMs, run } from './process.mjs';

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
  const issueNumber = Number(state?.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error('A valid issue number is required to send a controller follow-up to the Coder.');
  }
  const current = loadRun(root, issueNumber);
  if (!current) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const agentId = current.coderAgentId || current.agentId;
  if (!agentId) throw new Error('Coder agent ID is missing.');
  const at = new Date().toISOString();
  saveRun(root, issueNumber, {
    ...current,
    coderPrompt: prompt,
    coderPromptRecordedAt: at,
    coderPromptKind: 'controller-follow-up',
    coderPrompts: [...(Array.isArray(current.coderPrompts) ? current.coderPrompts : []), { attempt: current.attempt || 1, kind: 'controller-follow-up', at, prompt }],
    updatedAt: at,
  });
  const sent = run('paseo', ['send', String(agentId), '--no-wait', prompt], { cwd: root, allowFailure: true });
  if (!sent.ok) throw new Error(sent.stderr || sent.stdout || 'Paseo could not send the repair task to the Coder.');
  waitForCoder(root, current);
}

function latestValidation(state) {
  return [...(state.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary' && event.result === 'PASS' && event.commit);
}

function worktreeHead(root, state) {
  const cwd = state.worktreePath || root;
  const result = run('git', ['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  return result.ok ? result.stdout : null;
}

function worktreeClean(root, state) {
  const cwd = state.worktreePath || root;
  const result = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, allowFailure: true });
  return {
    ok: result.ok && !String(result.stdout || '').trim(),
    reason: result.ok
      ? String(result.stdout || '').trim()
      : result.stderr || result.stdout || 'Could not inspect the issue worktree status.',
  };
}

function completionEvidenceError(message) {
  const error = new Error(message);
  error.code = 'CODER_COMPLETION_EVIDENCE_INCOMPLETE';
  return error;
}

function controllerValidation(root, issueNumber, state, head) {
  const existing = latestValidation(state);
  if (existing?.commit === head) return { state, validation: existing };
  const saved = recordEvent(root, issueNumber, {
    event: 'validation-summary',
    result: 'PASS',
    commit: head,
    details: 'Controller recorded the exact-head validation handoff after the coder completed with a clean worktree, exact pushed branch head, and matching open PR. Issue-required validation remains subject to independent review and GitHub CI.',
  });
  updateState(root, issueNumber, {}, {
    type: 'controller-validation-recorded',
    details: `Recorded controller-owned validation handoff for exact PR head ${head}.`,
  });
  return { state: saved, validation: latestValidation(saved) };
}

function requireValidatedPr(root, issueNumber) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  if (state.status !== 'agent-running') return { terminal: true, state };

  const head = worktreeHead(root, state);
  if (!head) throw completionEvidenceError('Coder finished without a readable worktree HEAD.');
  const cleanliness = worktreeClean(root, state);
  if (!cleanliness.ok) {
    const detail = cleanliness.reason ? ` ${cleanliness.reason}` : '';
    throw completionEvidenceError(`Coder finished with uncommitted worktree changes or an unreadable worktree status.${detail}`);
  }

  let pr = currentPr(root, state);
  if (!pr) {
    try {
      const ensured = ensureDraftPr(root, issueNumber, state, head);
      pr = ensured.pr;
      if (ensured.created) {
        updateState(root, issueNumber, { prNumber: pr.number, prUrl: pr.url }, {
          type: 'controller-draft-pr-created',
          details: `Controller created draft PR #${pr.number} for exact pushed head ${head}.`,
        });
      }
    } catch (error) {
      if (error?.code === 'CODER_BRANCH_NOT_PUSHED') throw completionEvidenceError(error.message);
      throw error;
    }
  }

  if (!pr || head !== pr.headRefOid) {
    throw completionEvidenceError('Worktree HEAD and pull-request HEAD do not identify the same exact commit.');
  }
  const handoff = refreshControllerDraftPrHandoff(root, state, pr, head);
  if (handoff.updated) {
    pr = { ...pr, body: handoff.body };
    updateState(root, issueNumber, {}, {
      type: 'controller-draft-pr-handoff-refreshed',
      details: `Refreshed controller-owned PR #${pr.number} handoff metadata for current exact head ${head}.`,
    });
  }
  const recorded = controllerValidation(root, issueNumber, state, head);
  return { terminal: false, state: recorded.state, validation: recorded.validation, pr, head };
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
      details: `Coder completion handoff was incomplete; recovery attempt ${recovery.attempts}/${MAX_COMPLETION_RECOVERY_ATTEMPTS}: ${reason}`,
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

function branchContainsLatestBase(root, issueNumber, state, baseBranch) {
  const freshness = inspectBaseFreshness(root, state, baseBranch);
  appendIssueLifecycle(root, issueNumber, {
    attempt: state?.attempt,
    type: 'base-freshness-check',
    status: freshness.status === 'current' ? 'success' : freshness.status === 'stale' ? 'warning' : 'error',
    source: 'controller',
    message: freshness.reason,
    evidence: freshness.evidence,
  });
  if (freshness.status === 'indeterminate' || freshness.status === 'inconsistent') {
    const error = new Error(freshness.reason);
    error.code = 'BASE_FRESHNESS_CONTROLLER_ERROR';
    throw error;
  }
  return freshness;
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

async function execute(root, issueNumber, expectedAttempt = null) {
  const initialState = loadRun(root, issueNumber);
  if (expectedAttempt && Number(initialState?.attempt) !== expectedAttempt) {
    throw new Error(`Controller attempt ownership changed for issue #${issueNumber}.`);
  }
  const config = loadConfig(root);
  let repairCycles = 0;
  const completionRecovery = { attempts: 0 };
  const maximumRepairCycles = Math.max(
    Number(config.review?.quickMaxRounds || 0),
    Number(config.review?.fullMaxRounds || config.maxReviewRounds || 0),
  ) + 4;

  waitForCoder(root, initialState);

  while (repairCycles <= maximumRepairCycles) {
    const snapshot = requireValidatedPrWithRecovery(root, issueNumber, completionRecovery);
    if (snapshot.terminal) return;

    const freshness = branchContainsLatestBase(root, issueNumber, snapshot.state, config.baseBranch);
    const conflicting = snapshot.pr.mergeable === 'CONFLICTING' || snapshot.pr.mergeStateStatus === 'DIRTY';
    if (!freshness.ok || conflicting) {
      const reason = conflicting ? 'GitHub reports merge conflicts with the current base branch.' : freshness.reason;
      updateState(root, issueNumber, { phase: 'updating-from-base' }, { type: 'base-update-required', details: reason });
      sendCoder(root, snapshot.state, buildBaseUpdatePrompt({ issueNumber, baseBranch: config.baseBranch, reason }));
      repairCycles += 1;
      continue;
    }

    const reviewRound = configuredReviewRound(snapshot.state, config);
    const reviewRequestId = reviewRequestIdentity({
      issueNumber,
      pullRequestNumber: snapshot.pr.number,
      headSha: snapshot.head,
      stage: reviewRound.stage,
      round: reviewRound.round,
    });
    updateState(root, issueNumber, {
      reviewRequestId,
      reviewSchemaRetryCount: 0,
    });
    const reviewAttempt = runStructuredReviewWithRetry({
      expectedHeadSha: snapshot.head,
      requestId: reviewRequestId,
      currentHead: () => currentPr(root, snapshot.state)?.headRefOid || null,
      runReview: () => runConfiguredHarnessReview(root, issueNumber, snapshot, { config }),
      onRetry: ({ attempt, detail }) => {
        updateState(root, issueNumber, {
          reviewRequestId,
          reviewSchemaRetryCount: attempt - 1,
        }, {
          type: 'review-schema-retry',
          details: `Structured review output was invalid; retrying the same exact-head review request (${reviewRequestId}) once. ${detail}`,
        });
        appendIssueLifecycle(root, issueNumber, {
          attempt: snapshot.state.attempt,
          type: 'review-schema-retry',
          status: 'warning',
          source: 'controller',
          message: `Retrying malformed structured review output for exact head ${snapshot.head}.`,
          evidence: {
            reviewRequestId,
            pullRequestNumber: snapshot.pr.number,
            headSha: snapshot.head,
            stage: reviewRound.stage,
            round: reviewRound.round,
            retryAttempt: attempt,
          },
        });
      },
      onPermissionWait: ({ detail }) => {
        const phase = reviewRound.stage === 'quick' ? 'reviewing-light-permission' : 'reviewing-heavy-permission';
        updateState(root, issueNumber, {
          phase,
          controllerPid: null,
          reason: detail,
          reviewPermissionWaitAt: new Date().toISOString(),
        }, {
          type: 'review-permission-wait',
          details: `Structured review is waiting for a legitimate permission decision; the controller will not terminalize the exact-head request. ${detail}`,
        });
        appendIssueLifecycle(root, issueNumber, {
          attempt: snapshot.state.attempt,
          type: 'review-permission-wait',
          status: 'waiting',
          source: 'controller',
          message: detail,
          evidence: {
            reviewRequestId,
            pullRequestNumber: snapshot.pr.number,
            headSha: snapshot.head,
            stage: reviewRound.stage,
            round: reviewRound.round,
          },
        });
      },
      onStale: ({ currentHeadSha }) => {
        updateState(root, issueNumber, {
          reviewRequestId,
          reviewSchemaRetryCount: 0,
        }, {
          type: 'review-schema-retry-stale',
          details: `Structured review retry was skipped because PR #${snapshot.pr.number} moved from ${snapshot.head} to ${currentHeadSha || '(missing)'}.`,
        });
        appendIssueLifecycle(root, issueNumber, {
          attempt: snapshot.state.attempt,
          type: 'review-schema-retry-stale',
          status: 'warning',
          source: 'controller',
          message: 'Malformed review output was discarded because the exact PR head changed before retry.',
          evidence: {
            reviewRequestId,
            pullRequestNumber: snapshot.pr.number,
            requestedHeadSha: snapshot.head,
            currentHeadSha: currentHeadSha || null,
          },
        });
      },
      onExhausted: ({ attempt, detail }) => {
        updateState(root, issueNumber, {
          reviewRequestId,
          reviewSchemaRetryCount: attempt - 1,
        }, {
          type: 'review-schema-retry-exhausted',
          details: `Structured review output remained invalid after the bounded retry for ${reviewRequestId}. ${detail}`,
        });
        appendIssueLifecycle(root, issueNumber, {
          attempt: snapshot.state.attempt,
          type: 'review-schema-retry-exhausted',
          status: 'error',
          source: 'controller',
          message: `Structured review output remained invalid after ${attempt} attempts for exact head ${snapshot.head}.`,
          evidence: {
            reviewRequestId,
            pullRequestNumber: snapshot.pr.number,
            headSha: snapshot.head,
            stage: reviewRound.stage,
            round: reviewRound.round,
            attempts: attempt,
          },
        });
      },
    });
    if (reviewAttempt.pending) return;
    if (reviewAttempt.stale) continue;
    const review = reviewAttempt.review;
    if (review.decision.action === 'stale') continue;
    if (review.decision.action === 'repair') {
      const findings = reviewRepairInstructions(review);
      updateState(root, issueNumber, { phase: 'repairing' }, {
        type: 'review-changes-required',
        details: findings,
      });
      sendCoder(root, snapshot.state, buildRepairPrompt({ issueNumber, findings }));
      repairCycles += 1;
      continue;
    }
    if (review.decision.action === 'attention') {
      markReviewNeedsAttention(root, issueNumber, snapshot, review);
      return;
    }
    if (review.decision.action === 'quick-passed' || review.decision.action === 'handoff') {
      enterConfiguredQuickHandoff(root, issueNumber, snapshot, review, { config });
      return;
    }
    if (review.decision.action !== 'full-passed') {
      throw new Error(`Unsupported staged review decision: ${review.decision.action || '(missing)'}.`);
    }

    const afterReview = requireValidatedPrWithRecovery(root, issueNumber, completionRecovery);
    if (afterReview.head !== snapshot.head) continue;
    const postReviewFreshness = branchContainsLatestBase(root, issueNumber, afterReview.state, config.baseBranch);
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
    const finalFreshness = branchContainsLatestBase(root, issueNumber, finalSnapshot.state, config.baseBranch);
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

    updateState(root, issueNumber, { phase: 'finalizing-approved-pr' });
    finalizeApprovedPullRequest(root, {
      repository: review.repository,
      issueNumber,
      issueUrl: review.issue?.url,
      pullRequest: finalSnapshot.pr,
      state: finalSnapshot.state,
      findings: review.event.findings,
      unresolvedFindings: false,
      approvalSource: 'harness-review',
    }, { config });
    return;
  }
  throw new Error('Maximum controller repair cycles reached.');
}

async function main() {
  const [root, rawIssue, rawAttempt] = process.argv.slice(2);
  const issueNumber = Number(rawIssue);
  const expectedAttempt = rawAttempt === undefined ? null : Number(rawAttempt);
  if (!root || !Number.isInteger(issueNumber) || (rawAttempt !== undefined && (!Number.isInteger(expectedAttempt) || expectedAttempt <= 0))) {
    throw new Error('Usage: controller-worker.mjs <repository-root> <issue-number> [attempt]');
  }
  try {
    await execute(root, issueNumber, expectedAttempt);
  } catch (error) {
    const state = loadRun(root, issueNumber);
    const ownsCurrentAttempt = !expectedAttempt || Number(state?.attempt) === expectedAttempt;
    if (ownsCurrentAttempt && state?.status === 'agent-running') {
      terminalState(root, issueNumber, 'failed', error.message);
    }
    process.exitCode = 1;
  }
}

await main();
