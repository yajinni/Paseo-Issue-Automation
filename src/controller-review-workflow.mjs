import { recordEvent } from './automation.mjs';
import {
  createHarnessReviewEvent,
  createQuickHandoffEvent,
  harnessReviewStage,
  nextReviewRound,
  reviewStageDecision,
  summarizeReviewFindings,
} from './harness-review-stages.mjs';
import { LEGACY_LABELS, PASEO_LABELS } from './label-catalog.mjs';
import { enterManualReview } from './manual-review-lifecycle.mjs';
import { registerManualReviewPullRequest } from './manual-review-reconcile.mjs';
import { handoffValidatedPullRequest, prReviewAutomationEnabled } from './pr-review-handoff.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { reviewJobId } from './review-prompt.mjs';
import { postReviewerAuditComment } from './reviewer-audit.mjs';
import {
  REVIEW_STAGES,
  REVIEW_WORKFLOW_OUTPUT_SCHEMA,
  REVIEW_WORKFLOW_PROMPT_VERSION,
  renderReviewWorkflowPrompt,
} from './review-workflow-prompts.mjs';
import { agentCommandTimeoutMs, run, runJson } from './process.mjs';
import { appendIssueLifecycle, loadConfig, loadRun, saveRun } from './state.mjs';
import { recordWebChatGptFullReviewMetadata } from './web-chatgpt-full-review.mjs';

function nowIso() {
  return new Date().toISOString();
}

function latestValidationForHead(state, headSha) {
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary'
      && event.result === 'PASS'
      && event.commit === headSha) || null;
}

function compactChecks(pr = {}) {
  return (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []).map((check) => ({
    name: check.name || check.context || check.workflowName || 'check',
    state: check.conclusion || check.state || check.status || 'UNKNOWN',
  }));
}

function updateRun(root, issueNumber, patch, activity = null) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const at = nowIso();
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

function currentPrHead(root, pullRequestNumber, jsonRunner = runJson) {
  const pr = jsonRunner('gh', [
    'pr', 'view', String(pullRequestNumber),
    '--json', 'number,state,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup,url',
  ], { cwd: root, allowFailure: true });
  return pr || null;
}

function reviewContexts({ issue, snapshot, config, state }) {
  const validation = latestValidationForHead(state, snapshot.head);
  const issueContext = [
    `Issue #${issue.number}: ${issue.title || ''}`,
    issue.body || '',
  ].filter(Boolean).join('\n\n');
  const changeContext = [
    `Review the exact branch ${snapshot.state.branch} at ${snapshot.head}.`,
    `The pull request is #${snapshot.pr.number} targeting ${snapshot.pr.baseRefName || config.baseBranch}.`,
    'Use the repository workspace to inspect the exact diff and relevant surrounding code.',
  ].join('\n');
  const validationContext = JSON.stringify({
    exactHead: snapshot.head,
    controllerValidation: validation
      ? { result: validation.result, commit: validation.commit, details: validation.details || null }
      : null,
    githubChecks: compactChecks(snapshot.pr),
  });
  return { issueContext, changeContext, validationContext };
}

function recordStructuredReviewAudit(root, issueNumber, snapshot, event, {
  runner = run,
} = {}) {
  if (!['pass', 'changes'].includes(event.result)) return null;
  const findings = summarizeReviewFindings(event);
  recordEvent(root, issueNumber, {
    event: 'review',
    result: event.result === 'pass' ? 'APPROVED' : 'CHANGES_REQUIRED',
    commit: event.headSha,
    details: findings,
    source: 'harness-review-compat',
  });
  const audit = postReviewerAuditComment(root, {
    issueNumber,
    prNumber: snapshot.pr.number,
    commit: event.headSha,
    round: event.round,
    approved: event.result === 'pass',
    findings,
  }, { runner });
  updateRun(root, issueNumber, {}, {
    type: 'review-audit-posted',
    details: `Posted ${audit.verdict} for ${audit.commit} to PR #${audit.prNumber} (round ${audit.round}).`,
  });
  return audit;
}

export function configuredReviewStage(config = {}) {
  return harnessReviewStage(config);
}

export function configuredReviewRound(state = {}, config = {}) {
  const stage = configuredReviewStage(config);
  return { stage, round: nextReviewRound(state, stage) };
}

export function reviewDecisionForVerdict({ config = {}, state = {}, verdict } = {}) {
  return reviewStageDecision({
    config,
    state,
    stage: verdict?.stage,
    verdict,
  });
}

export function runConfiguredHarnessReview(root, issueNumber, snapshot, {
  config = loadConfig(root),
  jsonRunner = runJson,
  agentRunner = runJson,
  auditRunner = run,
} = {}) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const repository = jsonRunner('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
  const issue = jsonRunner('gh', [
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,body,url,comments,blockedBy,blocking',
  ], { cwd: root });
  if (!repository || !issue) throw new Error('Could not load repository or issue context for staged review.');

  const { stage, round } = configuredReviewRound(state, config);
  const expected = {
    repository,
    pullRequestNumber: Number(snapshot.pr.number),
    issueNumber: Number(issueNumber),
    headSha: snapshot.head,
    stage,
    round,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
  };
  const contexts = reviewContexts({ issue, snapshot, config, state });
  const prompt = renderReviewWorkflowPrompt({
    ...expected,
    ...contexts,
    quickFindings: '',
  });
  const label = stage === REVIEW_STAGES.quick ? 'Light' : 'Heavy';
  updateRun(root, issueNumber, {
    phase: stage === REVIEW_STAGES.quick ? 'reviewing-light' : 'reviewing-heavy',
    reviewRuntimeStage: stage,
    prNumber: snapshot.pr.number,
    prUrl: snapshot.pr.url,
  }, {
    type: 'review-started',
    details: `${label} review round ${round} started for exact head ${snapshot.head}.`,
  });

  const verdict = agentRunner('paseo', [
    'run', '--provider', config.models.reviewer,
    ...(config.models.reviewerThinking ? ['--thinking', config.models.reviewerThinking] : []),
    '--workspace', String(snapshot.state.workspaceId),
    '--title', `Issue #${issueNumber} ${label} Reviewer`,
    '--output-schema', REVIEW_WORKFLOW_OUTPUT_SCHEMA,
    prompt,
  ], { cwd: root, timeoutMs: agentCommandTimeoutMs() });
  if (!verdict || typeof verdict !== 'object') throw new Error('Reviewer did not return the required structured staged verdict.');

  const checked = {
    ...verdict,
    repository: verdict.repository,
    pullRequestNumber: Number(verdict.pullRequestNumber),
    issueNumber: Number(verdict.issueNumber),
    round: Number(verdict.round),
    promptVersion: Number(verdict.promptVersion),
  };
  let event = createHarnessReviewEvent(checked, expected);
  const audit = recordStructuredReviewAudit(root, issueNumber, snapshot, event, { runner: auditRunner });
  const current = currentPrHead(root, snapshot.pr.number, jsonRunner);
  if (!current || String(current.headRefOid || '').toLowerCase() !== String(snapshot.head).toLowerCase()) {
    event = createHarnessReviewEvent({
      ...checked,
      result: 'stale',
      summary: 'The pull-request head changed before the staged verdict could be accepted.',
      findings: [],
    }, expected);
  }

  const decision = reviewStageDecision({ config, state, stage, verdict: event });
  const saved = recordEvent(root, issueNumber, event);
  return {
    repository,
    issue,
    expected,
    event,
    verdict: event,
    decision,
    state: saved,
    stage,
    round,
    audit,
  };
}

function releaseCodingSlot(root, issueNumber, runner = run) {
  const released = runner('gh', [
    'issue', 'edit', String(issueNumber),
    '--remove-label', LEGACY_LABELS.running,
    '--add-label', PASEO_LABELS.reviewQueued,
  ], { cwd: root, allowFailure: true });
  if (!released.ok) {
    throw new Error(released.stderr || released.stdout || `Could not release the coding slot for issue #${issueNumber}.`);
  }
}

function handoffEvent(config, review) {
  return createQuickHandoffEvent(config, { events: [review.event] });
}

function handoffFindings(review) {
  return review.decision.action === 'handoff'
    ? (Array.isArray(review.event.findings) ? review.event.findings : [])
    : [];
}

function validationSummary(state, headSha) {
  const validation = latestValidationForHead(state, headSha);
  return validation?.details || `Controller PASS validation is recorded for exact head ${headSha}.`;
}

export function enterConfiguredQuickHandoff(root, issueNumber, snapshot, review, {
  config = loadConfig(root),
  runner = run,
} = {}) {
  if (!['quick-passed', 'handoff'].includes(review?.decision?.action)) {
    throw new Error('Quick review has not reached a handoff decision.');
  }
  const findings = handoffFindings(review);
  const quickExhausted = review.decision.action === 'handoff';
  const event = handoffEvent(config, review);

  if (config.review?.workflow === 'quick-manual') {
    enterManualReview(root, {
      pullRequestNumber: snapshot.pr.number,
      headSha: snapshot.head,
      validationSummary: validationSummary(review.state, snapshot.head),
      quickFindings: findings,
      quickExhausted,
      isDraft: snapshot.pr.isDraft === true,
    }, { runner });
    registerManualReviewPullRequest(root, {
      repository: review.repository,
      issueNumber,
      issueUrl: review.issue?.url,
      pullRequestNumber: snapshot.pr.number,
      pullRequestUrl: snapshot.pr.url,
      branchName: snapshot.state.branch,
      worktreePath: snapshot.state.worktreePath,
      workspaceId: snapshot.state.workspaceId,
      coderAgentId: snapshot.state.coderAgentId || snapshot.state.agentId,
      currentHeadSha: snapshot.head,
      reviewRound: 1,
    });
    releaseCodingSlot(root, issueNumber, runner);
    const saved = updateRun(root, issueNumber, {
      status: PASEO_LABELS.reviewQueued,
      phase: 'manual-review',
      reviewRuntimeStage: 'full-manual',
      reviewExpectedHeadSha: snapshot.head,
      prNumber: snapshot.pr.number,
      prUrl: snapshot.pr.url,
      completedAt: null,
      controllerPid: null,
    }, {
      type: 'manual-review-handoff',
      details: `Light review handed PR #${snapshot.pr.number} to manual review at exact head ${snapshot.head}.`,
    });
    recordEvent(root, issueNumber, event);
    appendIssueLifecycle(root, issueNumber, {
      attempt: saved.attempt,
      type: 'pr-review-queued',
      status: 'success',
      source: 'controller',
      message: `PR #${snapshot.pr.number} entered manual review at ${snapshot.head}.`,
      evidence: { pullRequestNumber: snapshot.pr.number, headSha: snapshot.head, reviewRuntimeStage: 'full-manual' },
    });
    return { handedOff: true, target: 'manual', state: loadRun(root, issueNumber) };
  }

  if (config.review?.workflow === 'quick-web-chatgpt') {
    if (!prReviewAutomationEnabled(root)) {
      throw new Error('Web ChatGPT review is selected, but PR-review automation is not enabled.');
    }
    const store = loadPrReviewStore(root);
    const promptVersion = Number(store.config.browserReview.reviewPromptVersion);
    const id = reviewJobId({
      repository: review.repository,
      pullRequestNumber: snapshot.pr.number,
      headSha: snapshot.head,
      reviewPromptVersion: promptVersion,
    });
    recordWebChatGptFullReviewMetadata(root, id, {
      stageRound: nextReviewRound(review.state, REVIEW_STAGES.full),
      maxStageRounds: config.review.fullMaxRounds,
      quickFindings: findings,
    });
    const registered = handoffValidatedPullRequest(root, {
      repository: review.repository,
      issue: review.issue,
      state: snapshot.state,
      pr: snapshot.pr,
      headSha: snapshot.head,
    });
    if (registered.reviewJob?.id !== id) {
      throw new Error('Staged Web ChatGPT review registration did not produce the expected exact-head review job.');
    }
    recordEvent(root, issueNumber, event);
    updateRun(root, issueNumber, {
      reviewRuntimeStage: 'full-web-chatgpt',
      reviewExpectedHeadSha: snapshot.head,
    }, {
      type: 'web-chatgpt-full-review-handoff',
      details: `Light review handed PR #${snapshot.pr.number} to staged Web ChatGPT full review at ${snapshot.head}.`,
    });
    appendIssueLifecycle(root, issueNumber, {
      attempt: snapshot.state.attempt,
      type: 'pr-review-queued',
      status: 'success',
      source: 'controller',
      message: `PR #${snapshot.pr.number} queued for staged Web ChatGPT full review at ${snapshot.head}.`,
      evidence: { pullRequestNumber: snapshot.pr.number, headSha: snapshot.head, reviewRuntimeStage: 'full-web-chatgpt', reviewJobId: id },
    });
    return { handedOff: true, target: 'web-chatgpt', reviewJob: registered.reviewJob, managed: registered.managed };
  }

  throw new Error(`Quick review cannot hand off for workflow ${config.review?.workflow || '(missing)'}.`);
}

export function reviewRepairInstructions(review) {
  return summarizeReviewFindings(review?.event || review?.verdict || {});
}

export function markReviewNeedsAttention(root, issueNumber, snapshot, review, {
  runner = run,
} = {}) {
  const reason = `Heavy review exhausted round ${review.round} of ${review.decision.limit} with unresolved blocking changes.`;
  const issueLabels = runner('gh', [
    'issue', 'edit', String(issueNumber),
    '--remove-label', LEGACY_LABELS.running,
    '--add-label', PASEO_LABELS.needsAttention,
  ], { cwd: root, allowFailure: true });
  if (!issueLabels.ok) throw new Error(issueLabels.stderr || issueLabels.stdout || reason);
  const prLabels = runner('gh', [
    'pr', 'edit', String(snapshot.pr.number),
    '--add-label', PASEO_LABELS.changesRequested,
  ], { cwd: root, allowFailure: true });
  if (!prLabels.ok) throw new Error(prLabels.stderr || prLabels.stdout || reason);
  const state = updateRun(root, issueNumber, {
    status: PASEO_LABELS.needsAttention,
    phase: 'review-attention',
    reason,
    completedAt: nowIso(),
    controllerPid: null,
  }, {
    type: 'review-rounds-exhausted',
    details: reason,
  });
  appendIssueLifecycle(root, issueNumber, {
    attempt: state.attempt,
    type: 'review-needs-attention',
    status: 'warning',
    source: 'controller',
    message: reason,
    evidence: {
      pullRequestNumber: snapshot.pr.number,
      headSha: snapshot.head,
      stage: review.stage,
      round: review.round,
      limit: review.decision.limit,
    },
  });
  return state;
}
