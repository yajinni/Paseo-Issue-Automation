import {
  currentLabelForLegacy,
  isManagedLifecycleLabel,
  PASEO_LABELS,
} from './label-catalog.mjs';

const LIFECYCLE_META = Object.freeze({
  [PASEO_LABELS.ready]: ['ready', 'Available'],
  [PASEO_LABELS.queued]: ['queued', 'Claimed'],
  [PASEO_LABELS.coding]: ['coding', 'Coding'],
  [PASEO_LABELS.reviewQueued]: ['review-queued', 'PR Review Queued'],
  [PASEO_LABELS.reviewing]: ['reviewing', 'Reviewing'],
  [PASEO_LABELS.changesRequested]: ['changes-requested', 'Changes requested'],
  [PASEO_LABELS.fixing]: ['fixing', 'Fixing'],
  [PASEO_LABELS.reviewFailed]: ['review-failed', 'Review failed'],
  [PASEO_LABELS.failed]: ['failed', 'Failed'],
  [PASEO_LABELS.needsAttention]: ['needs-attention', 'Needs attention'],
  abandoned: ['abandoned', 'Abandoned'],
});

const PHASE_META = Object.freeze({
  'waiting-for-dependencies': ['waiting', 'Waiting for dependencies'],
  'dependency-wait': ['waiting', 'Waiting for dependencies'],
  ready: ['ready', 'Available'],
  queued: ['queued', 'Claimed'],
  coding: ['coding', 'Coding'],
  'starting-agent': ['coding', 'Starting coding'],
  'launch-retrying': ['coding', 'Retrying coding launch'],
  'launch-reconciliation-needed': ['needs-attention', 'Launch needs attention'],
  'review-queued': ['review-queued', 'PR Review Queued'],
  reviewing: ['reviewing', 'Reviewing'],
  'reviewing-light-permission': ['reviewing', 'Reviewing (permission pending)'],
  'reviewing-heavy-permission': ['reviewing', 'Reviewing (permission pending)'],
  review: ['reviewing', 'Reviewing'],
  'changes-requested': ['changes-requested', 'Changes requested'],
  fixing: ['fixing', 'Fixing'],
  'review-failed': ['review-failed', 'Review failed'],
  failed: ['failed', 'Failed'],
  'launch-failed': ['failed', 'Failed'],
  abandoned: ['abandoned', 'Abandoned'],
  'invalid-issue': ['needs-attention', 'Needs attention'],
  merged: ['merged', 'Merged'],
  'issue-closure-verified': ['closure-verified', 'Issue Closure Verified'],
  completed: ['completed', 'Completed'],
  closed: ['completed', 'Completed'],
});

const ACTIVE_STAGES = new Set([
  'queued',
  'coding',
  'review-queued',
  'reviewing',
  'changes-requested',
  'fixing',
  'merged',
  'closure-verified',
]);

const ACTIVE_PHASES = new Set([
  'auto-merge-requested',
  'creating-workspace',
  'finalizing-approved-pr',
  'manual-review-fix-queued',
  'manual-review-merged-pending-finalization',
  'manual-review-stale-head',
  'recovering-completion-evidence',
  'recovering-failed-attempt',
  'repairing',
  'resuming-existing-pr-controller',
  'restarting',
  'restart-queued',
  'reviewing-heavy',
  'reviewing-light',
  'updating-from-base',
  'verifying-workspace',
  'waiting-for-ci',
]);

const TERMINAL_STAGES = new Set(['completed', 'failed', 'abandoned', 'review-failed', 'needs-attention']);

const TERMINAL_PHASES = new Set([
  'abandoned',
  'blocked',
  'failed',
  'invalid-issue',
  'launch-failed',
  'needs-attention',
  'review-attention',
]);

const TERMINAL_STATUSES = new Set([
  'abandoned',
  'agent-blocked',
  'agent-failed',
  'automation-blocked',
  'automation-failed',
  'blocked',
  'closed',
  'completed',
  'failed',
  'merged',
  PASEO_LABELS.failed,
  PASEO_LABELS.needsAttention,
  PASEO_LABELS.reviewFailed,
]);

const ACTIVE_REVIEW_STATES = new Set([
  'queued',
  'submitting',
  'awaiting_result',
  'awaiting-result',
  'starting',
  'running',
  'reviewing',
  'fixing',
  'in-progress',
  'in_progress',
]);

function lifecycleForRun(run = {}) {
  const stored = String(run.status || '').trim();
  if (isManagedLifecycleLabel(stored)) return stored;
  const compatible = currentLabelForLegacy(stored);
  return compatible && isManagedLifecycleLabel(compatible) ? compatible : null;
}

function stageForRun(run = {}) {
  const phase = String(run.phase || '').trim();
  if (String(run.status || '') === 'abandoned' || phase === 'abandoned') {
    return { id: 'abandoned', label: 'Abandoned', waiting: false };
  }
  if (PHASE_META[phase]) {
    const [id, label] = PHASE_META[phase];
    return { id, label, waiting: id === 'waiting' };
  }
  if (!phase && run.issueClosureVerifiedAt && !run.completedAt) return { id: 'closure-verified', label: 'Issue Closure Verified', waiting: false };
  if (!phase && run.mergedAt && !run.completedAt) return { id: 'merged', label: 'Merged', waiting: false };
  const lifecycle = lifecycleForRun(run);
  if (lifecycle && LIFECYCLE_META[lifecycle]) {
    const [id, label] = LIFECYCLE_META[lifecycle];
    return { id, label, waiting: false };
  }
  if (run.completedAt) return { id: 'completed', label: 'Completed', waiting: false };
  return { id: 'unknown', label: 'Unknown', waiting: false };
}

function hasValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && Boolean(value.trim());
}

function hasLiveReviewEvidence(work = {}) {
  const reviewAutomation = work.reviewAutomation && typeof work.reviewAutomation === 'object'
    ? work.reviewAutomation
    : {};
  const reviewJob = reviewAutomation.latestReviewJob || {};
  const fixJob = reviewAutomation.latestFixJob || {};
  return ACTIVE_REVIEW_STATES.has(String(reviewJob.state || '').trim().toLowerCase())
    || ACTIVE_REVIEW_STATES.has(String(fixJob.state || '').trim().toLowerCase())
    || hasValue(reviewAutomation.activeReviewRequestId);
}

function hasLiveManagedEvidence(work = {}) {
  const diagnostics = work.diagnostics && typeof work.diagnostics === 'object' ? work.diagnostics : {};
  return [
    work.workspaceId,
    work.worktreePath,
    work.coderAgentId,
    work.agentId,
    work.pullRequestNumber,
    work.prNumber,
    work.pullRequest?.number,
    diagnostics.workspaceId,
    diagnostics.worktreePath,
    diagnostics.coderAgentId,
  ].some(hasValue) || work.controllerLive === true || hasLiveReviewEvidence(work);
}

function hasLiveProcessEvidence(work = {}) {
  return work.controllerLive === true || hasLiveReviewEvidence(work);
}

export function isManagerWorkActive(work = {}) {
  if (typeof work.active === 'boolean') return work.active;
  const stage = String(work.stage || stageForRun(work).id);
  const phase = String(work.phase || '').trim();
  const status = String(work.status || '').trim();
  const terminal = Boolean(work.completedAt)
    || TERMINAL_STAGES.has(stage)
    || TERMINAL_PHASES.has(phase)
    || TERMINAL_STATUSES.has(status);
  if (terminal) {
    return hasLiveProcessEvidence(work);
  }
  if (ACTIVE_STAGES.has(stage)) return true;
  if (ACTIVE_PHASES.has(phase)) return true;
  if (stage === 'ready' || stage === 'waiting') return false;
  return hasLiveManagedEvidence(work);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pullRequestFromRun(run = {}) {
  const object = run.pullRequest && typeof run.pullRequest === 'object' ? run.pullRequest : {};
  const pr = run.pr && typeof run.pr === 'object' ? run.pr : {};
  const number = firstNumber(
    object.number,
    pr.number,
    run.pullRequestNumber,
    run.prNumber,
    run.review?.pullRequestNumber,
  );
  const url = firstString(object.url, pr.url, run.pullRequestUrl, run.prUrl, run.review?.pullRequestUrl);
  if (!number && !url) return null;
  return { number, url };
}

function eventTimestamp(event = {}) {
  return firstString(event.at, event.updatedAt, event.completedAt, event.startedAt, event.createdAt);
}

function eventDetail(event = {}) {
  const direct = firstString(event.details, event.detail, event.summary, event.message, event.reason);
  if (direct) return direct;
  const bits = [];
  if (event.stage) bits.push(String(event.stage));
  if (event.round) bits.push(`round ${event.round}`);
  if (event.result) bits.push(String(event.result));
  if (event.headSha) bits.push(`head ${String(event.headSha).slice(0, 12)}`);
  return bits.join(' · ') || null;
}

function lifecycleEvidenceDetail(event = {}) {
  const message = firstString(event.message, event.details, event.detail) || null;
  const evidence = event.evidence && typeof event.evidence === 'object' ? event.evidence : {};
  const facts = Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  if (!facts.length) return message;
  return [message, facts.join(' · ')].filter(Boolean).join('\n');
}

function legacyTimelineFromRun(run = {}) {
  const entries = [];
  for (const event of run.activity || []) {
    entries.push({
      type: firstString(event.type, event.event) || 'activity',
      at: eventTimestamp(event),
      detail: eventDetail(event),
      source: 'activity',
    });
  }
  for (const event of run.events || []) {
    entries.push({
      type: firstString(event.event, event.type) || 'event',
      at: eventTimestamp(event),
      detail: eventDetail(event),
      source: firstString(event.source) || 'event',
      stage: event.stage || null,
      round: Number.isInteger(Number(event.round)) ? Number(event.round) : null,
      result: event.result || null,
      headSha: firstString(event.headSha, event.commit),
      conversationUrl: firstString(event.conversationUrl),
    });
  }
  for (const attempt of run.history || []) {
    entries.push({
      type: 'attempt-history',
      at: firstString(attempt.completedAt, attempt.startedAt),
      detail: `Attempt ${attempt.attempt || '?'}${attempt.branch ? ` · ${attempt.branch}` : ''}${attempt.status ? ` · ${attempt.status}` : ''}`,
      source: 'history',
    });
  }
  return entries
    .filter((entry) => entry.at || entry.detail)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 50);
}

function timelineEntryKey(entry = {}) {
  return [entry.type, entry.at, entry.detail, entry.source].map((value) => String(value || '')).join('\u0000');
}

function lifecycleTimelineFromRun(run = {}) {
  return (run.lifecycle || [])
    .filter((event) => !(String(event?.source || '') === 'state' && String(event?.type || '') === 'run-state-changed'))
    .map((event) => ({
      id: event.id || null,
      type: firstString(event.type) || 'lifecycle',
      at: eventTimestamp(event),
      detail: lifecycleEvidenceDetail(event),
      source: firstString(event.source) || 'lifecycle',
      status: firstString(event.status),
      attempt: firstNumber(event.attempt),
      evidence: event.evidence && typeof event.evidence === 'object' ? event.evidence : {},
    }))
    .filter((entry) => entry.at || entry.detail)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 100);
}

function timelineFromRun(run = {}) {
  return Array.isArray(run.lifecycle) && run.lifecycle.length
    ? lifecycleTimelineFromRun(run)
    : legacyTimelineFromRun(run);
}

function legacyTimelineExtrasFromRun(run = {}) {
  if (!Array.isArray(run.lifecycle) || !run.lifecycle.length) return [];
  const known = new Set(lifecycleTimelineFromRun(run).map(timelineEntryKey));
  return legacyTimelineFromRun(run).filter((entry) => !known.has(timelineEntryKey(entry)));
}

function latestActivityAt(run = {}) {
  const timestamps = [
    run.updatedAt, run.heartbeatAt, run.completedAt, run.startedAt,
    ...(run.lifecycle || []).map(eventTimestamp),
    ...(run.activity || []).map(eventTimestamp),
    ...(run.events || []).map(eventTimestamp),
    ...(run.history || []).flatMap((attempt) => [attempt.completedAt, attempt.startedAt]),
  ].filter(Boolean).map((value) => String(value));
  return timestamps.sort().at(-1) || null;
}

function latestReviewEvent(run = {}) {
  const candidates = (run.events || [])
    .filter((event) => event && (event.stage || String(event.event || '').includes('review')))
    .filter((event) => Number.isInteger(Number(event.round)) || event.headSha || event.commit || event.result || event.source || event.conversationUrl)
    .sort((a, b) => String(eventTimestamp(b) || '').localeCompare(String(eventTimestamp(a) || '')));
  return candidates[0] || null;
}

function reviewMethod(event, stage, run, config) {
  const source = firstString(event?.source, run.review?.source);
  const conversationUrl = firstString(event?.conversationUrl, run.review?.conversationUrl);
  const sourceKey = String(source || '').toLowerCase();
  const workflow = String(config.review?.workflow || '');
  const runtimeStage = firstString(run.reviewRuntimeStage, run.review?.runtimeStage);
  const webStage = runtimeStage === 'full-web-chatgpt'
    || workflow === 'quick-web-chatgpt' && stage === 'full';
  const browserReview = webStage
    || Boolean(conversationUrl)
    || sourceKey.includes('browser')
    || sourceKey.includes('chatgpt')
    || String(stage || '').toLowerCase() === 'web-chatgpt';
  if (browserReview) {
    return {
      type: 'web-chatgpt',
      label: 'Web ChatGPT review',
      model: null,
      thinking: null,
      channel: 'Browser conversation',
      conversationUrl,
    };
  }
  if (stage === 'full' || runtimeStage === 'full-immediate' || workflow === 'full-immediate') {
    return {
      type: 'heavy',
      label: 'Heavy review',
      model: firstString(event?.model, run.review?.model, config.models?.reviewer),
      thinking: firstString(event?.thinking, run.review?.thinking, config.models?.reviewerThinking),
      channel: 'Provider/Coding Harness',
      conversationUrl: null,
    };
  }
  if (stage === 'quick' || runtimeStage === 'quick' || workflow === 'quick-manual' || workflow === 'quick-web-chatgpt') {
    return {
      type: 'light',
      label: 'Light review',
      model: firstString(event?.model, run.review?.model, config.models?.reviewer),
      thinking: firstString(event?.thinking, run.review?.thinking, config.models?.reviewerThinking),
      channel: 'Provider/Coding Harness',
      conversationUrl: null,
    };
  }
  return {
    type: 'review',
    label: 'Review',
    model: firstString(event?.model, run.review?.model, config.models?.reviewer),
    thinking: firstString(event?.thinking, run.review?.thinking, config.models?.reviewerThinking),
    channel: 'Provider/Coding Harness',
    conversationUrl: null,
  };
}

function reviewFromRun(run = {}, config = {}) {
  const event = latestReviewEvent(run);
  const stage = firstString(event?.stage, run.reviewStage, run.review?.stage);
  const round = firstNumber(event?.round, run.reviewRound, run.review?.round);
  const limit = stage === 'quick'
    ? Number(config.review?.quickMaxRounds || 0) || null
    : stage === 'full'
      ? Number(config.review?.fullMaxRounds || config.maxReviewRounds || 0) || null
      : Number(config.maxReviewRounds || 0) || null;
  const headSha = firstString(
    event?.headSha,
    event?.commit,
    run.currentHeadSha,
    run.review?.headSha,
    run.validationHeadSha,
    run.approvedHeadSha,
  );
  const method = reviewMethod(event, stage, run, config);
  const phase = String(run.phase || '');
  const lifecycle = lifecycleForRun(run);
  const reviewish = ['review-queued', 'reviewing', 'review', 'changes-requested', 'fixing', 'review-failed'].includes(phase)
    || [PASEO_LABELS.reviewQueued, PASEO_LABELS.reviewing, PASEO_LABELS.changesRequested, PASEO_LABELS.fixing, PASEO_LABELS.reviewFailed].includes(lifecycle);
  if (!reviewish && !stage && !round && !headSha && run.reviewApproved !== true && run.validationApproved !== true) return null;
  return {
    stage,
    round,
    limit,
    result: event?.result || null,
    headSha,
    source: firstString(event?.source, run.review?.source),
    runtimeStage: firstString(run.reviewRuntimeStage, run.review?.runtimeStage),
    validationApproved: run.validationApproved === true,
    validationHeadSha: firstString(run.validationHeadSha),
    reviewApproved: run.reviewApproved === true,
    approvedHeadSha: firstString(run.approvedHeadSha),
    ...method,
  };
}

function prAutomationFromStore(run = {}, store = null) {
  if (!store || typeof store !== 'object') return null;
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  const prNumber = pullRequestFromRun(run)?.number || null;
  const managed = (store.managedPullRequests || [])
    .filter((entry) => Number(entry?.issueNumber) === issueNumber)
    .filter((entry) => !prNumber || Number(entry?.pullRequestNumber) === prNumber)
    .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))[0] || null;
  if (!managed) return null;
  const reviews = (store.reviewJobs || [])
    .filter((job) => String(job?.managedPullRequestId || '') === String(managed.id))
    .sort((a, b) => String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || '')));
  const fixes = (store.fixJobs || [])
    .filter((job) => String(job?.managedPullRequestId || '') === String(managed.id))
    .sort((a, b) => String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || '')));
  const reviewJob = reviews[0] || null;
  const fixJob = fixes[0] || null;
  return {
    managedId: firstString(managed.id),
    reviewState: firstString(managed.reviewState),
    branchName: firstString(managed.branchName),
    currentHeadSha: firstString(managed.currentHeadSha),
    lastSubmittedReviewSha: firstString(managed.lastSubmittedReviewSha),
    lastCompletedReviewSha: firstString(managed.lastCompletedReviewSha),
    reviewRound: firstNumber(managed.reviewRound),
    queuePosition: finiteNumber(managed.queuePosition),
    activeReviewRequestId: firstString(managed.activeReviewRequestId),
    lastReviewCommentId: managed.lastReviewCommentId ?? null,
    lastProcessedReviewRequestId: firstString(managed.lastProcessedReviewRequestId),
    lastReconciledAt: firstString(managed.lastReconciledAt),
    lastActivityAt: firstString(managed.lastActivityAt),
    lastError: firstString(managed.lastError),
    issueClosurePending: managed.issueClosurePending === true,
    lifecycleCompletionPending: managed.lifecycleCompletionPending === true,
    reviewEvidenceMissing: managed.reviewEvidenceMissing === true,
    latestReviewJob: reviewJob ? {
      id: firstString(reviewJob.id),
      state: firstString(reviewJob.state),
      headSha: firstString(reviewJob.headSha),
      reviewRound: firstNumber(reviewJob.reviewRound),
      reviewRequestId: firstString(reviewJob.reviewRequestId),
      queuePosition: finiteNumber(reviewJob.queuePosition),
      attempts: finiteNumber(reviewJob.attempts),
      conversationUrl: firstString(reviewJob.conversationUrlUsed, reviewJob.conversationUrlOverride),
      submittedAt: firstString(reviewJob.submittedAt),
      completedAt: firstString(reviewJob.completedAt),
      lastError: firstString(reviewJob.lastError),
    } : null,
    latestFixJob: fixJob ? {
      id: firstString(fixJob.id),
      state: firstString(fixJob.state),
      reviewRequestId: firstString(fixJob.reviewRequestId),
      reviewedHeadSha: firstString(fixJob.reviewedHeadSha),
      newHeadSha: firstString(fixJob.newHeadSha),
      coderAgentId: firstString(fixJob.coderAgentId),
      attempts: finiteNumber(fixJob.attempts),
      startedAt: firstString(fixJob.startedAt),
      completedAt: firstString(fixJob.completedAt),
      lastError: firstString(fixJob.lastError),
    } : null,
  };
}

function nextAction(stage, run = {}) {
  if (run.reason) return String(run.reason);
  const defaults = {
    ready: 'Available for the next eligible scheduling turn.',
    queued: 'Claimed and waiting for coding capacity.',
    waiting: 'Waiting for native GitHub dependencies to clear.',
    coding: 'Coding work is in progress.',
    'review-queued': 'Waiting for PR review capacity.',
    reviewing: 'Pull request review is in progress.',
    'changes-requested': 'Review changes must be addressed.',
    fixing: 'Requested review changes are being fixed.',
    'review-failed': 'Review needs operator attention before it can continue.',
    failed: 'Coding automation needs recovery.',
    abandoned: 'This recorded attempt was abandoned by the operator.',
    'needs-attention': 'Operator attention is required.',
    completed: 'Automation is complete for this recorded run.',
    unknown: 'Open Details to inspect the recorded run state.',
  };
  return defaults[stage.id] || defaults.unknown;
}

function codingFromRun(run = {}, config = {}) {
  return {
    model: firstString(run.coderModel, run.coding?.model, config.models?.coder),
    thinking: firstString(run.coderThinking, run.coding?.thinking, config.models?.coderThinking),
    harness: firstString(run.codingHarness, run.coding?.harness, config.codingHarness),
  };
}

function diagnosticsFromRun(run = {}) {
  const priorPrompts = (run.history || []).flatMap((attempt) => (Array.isArray(attempt?.coderPrompts) ? attempt.coderPrompts : [])
    .map((prompt) => ({ ...prompt, attempt: prompt.attempt || attempt.attempt || null })));
  return {
    rawStatus: firstString(run.status),
    phase: firstString(run.phase),
    branch: firstString(run.branch),
    worktreePath: firstString(run.worktreePath),
    workspaceId: firstString(run.workspaceId),
    coderAgentId: firstString(run.coderAgentId, run.agentId),
    controllerPid: firstNumber(run.controllerPid, run.diagnostics?.controllerPid),
    coderModel: firstString(run.coderModel),
    coderThinking: firstString(run.coderThinking),
    codingHarness: firstString(run.codingHarness),
    reviewRuntimeStage: firstString(run.reviewRuntimeStage, run.review?.runtimeStage),
    heartbeatAt: firstString(run.heartbeatAt),
    currentHeadSha: firstString(run.currentHeadSha),
    validationHeadSha: firstString(run.validationHeadSha),
    approvedHeadSha: firstString(run.approvedHeadSha),
    approvedCommit: firstString(run.approvedCommit),
    mergedHeadSha: firstString(run.mergedHeadSha),
    mergedAt: firstString(run.mergedAt),
    issueClosureVerifiedAt: firstString(run.issueClosureVerifiedAt),
    baseBranch: firstString(run.baseBranch),
    baseSha: firstString(run.baseSha),
    baseRef: firstString(run.baseRef),
    baseVerifiedAt: firstString(run.baseVerifiedAt),
    coderPrompt: firstString(run.coderPrompt),
    coderPromptRecordedAt: firstString(run.coderPromptRecordedAt),
    coderPromptKind: firstString(run.coderPromptKind),
    coderPrompts: [...priorPrompts, ...(Array.isArray(run.coderPrompts) ? run.coderPrompts : [])],
  };
}

export function managerWorkQueueItem(run = {}, config = {}, prReviewStore = null) {
  const stage = stageForRun(run);
  const lifecycleLabel = lifecycleForRun(run);
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  const reviewAutomation = prAutomationFromStore(run, prReviewStore);
  const active = isManagerWorkActive({ ...run, stage: stage.id, reviewAutomation });
  return {
    issueNumber,
    title: firstString(run.issueTitle, run.issue?.title) || (issueNumber ? `Issue #${issueNumber}` : 'Recorded issue'),
    issueUrl: firstString(run.issueUrl, run.issue?.url),
    stage: stage.id,
    stageLabel: stage.label,
    active,
    controllerLive: run.controllerLive === true,
    lifecycleLabel,
    waitingForDependencies: stage.waiting,
    phase: firstString(run.phase),
    branch: firstString(run.branch),
    attempt: firstNumber(run.attempt),
    workspaceId: firstString(run.workspaceId),
    startedAt: firstString(run.startedAt),
     updatedAt: firstString(latestActivityAt(run), run.updatedAt, run.heartbeatAt, run.startedAt),
    completedAt: firstString(run.completedAt),
    reason: firstString(run.reason),
    nextAction: nextAction(stage, run),
    pullRequest: pullRequestFromRun(run),
    coding: codingFromRun(run, config),
    review: reviewFromRun(run, config),
    timeline: timelineFromRun(run),
    lifecycle: Array.isArray(run.lifecycle) ? run.lifecycle : [],
    legacyTimeline: legacyTimelineExtrasFromRun(run),
    diagnostics: diagnosticsFromRun(run),
    reviewAutomation,
  };
}

function stageCounts(items) {
  const counts = {};
  for (const item of items) counts[item.stage] = (counts[item.stage] || 0) + 1;
  return counts;
}

export function managerWorkQueue(runs = [], config = {}, prReviewStore = null) {
  const items = (runs || [])
    .filter(Boolean)
    .map((run) => managerWorkQueueItem(run, config, prReviewStore))
    .filter((item) => item.issueNumber)
     .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
       || Number(a.issueNumber) - Number(b.issueNumber));
  return {
    items,
    counts: stageCounts(items),
    total: items.length,
    active: items.filter((item) => item.active === true).length,
    attention: items.filter((item) => ['failed', 'abandoned', 'review-failed', 'needs-attention'].includes(item.stage)).length,
  };
}
