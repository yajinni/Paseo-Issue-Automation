import {
  currentLabelForLegacy,
  isManagedLifecycleLabel,
  PASEO_LABELS,
} from './label-catalog.mjs';

const LIFECYCLE_META = Object.freeze({
  [PASEO_LABELS.ready]: ['ready', 'Ready'],
  [PASEO_LABELS.queued]: ['queued', 'Queued'],
  [PASEO_LABELS.coding]: ['coding', 'Coding'],
  [PASEO_LABELS.reviewQueued]: ['review-queued', 'Review queued'],
  [PASEO_LABELS.reviewing]: ['reviewing', 'Reviewing'],
  [PASEO_LABELS.changesRequested]: ['changes-requested', 'Changes requested'],
  [PASEO_LABELS.fixing]: ['fixing', 'Fixing'],
  [PASEO_LABELS.reviewFailed]: ['review-failed', 'Review failed'],
  [PASEO_LABELS.failed]: ['failed', 'Failed'],
  [PASEO_LABELS.needsAttention]: ['needs-attention', 'Needs attention'],
});

const PHASE_META = Object.freeze({
  'waiting-for-dependencies': ['waiting', 'Waiting for dependencies'],
  'dependency-wait': ['waiting', 'Waiting for dependencies'],
  ready: ['ready', 'Ready'],
  queued: ['queued', 'Queued'],
  coding: ['coding', 'Coding'],
  'starting-agent': ['coding', 'Starting coding'],
  'launch-retrying': ['coding', 'Retrying coding launch'],
  'launch-reconciliation-needed': ['needs-attention', 'Launch needs attention'],
  'review-queued': ['review-queued', 'Review queued'],
  reviewing: ['reviewing', 'Reviewing'],
  review: ['reviewing', 'Reviewing'],
  'changes-requested': ['changes-requested', 'Changes requested'],
  fixing: ['fixing', 'Fixing'],
  'review-failed': ['review-failed', 'Review failed'],
  failed: ['failed', 'Failed'],
  'launch-failed': ['failed', 'Failed'],
  'invalid-issue': ['needs-attention', 'Needs attention'],
  completed: ['completed', 'Completed'],
  closed: ['completed', 'Completed'],
});

function lifecycleForRun(run = {}) {
  const stored = String(run.status || '').trim();
  if (isManagedLifecycleLabel(stored)) return stored;
  const compatible = currentLabelForLegacy(stored);
  return compatible && isManagedLifecycleLabel(compatible) ? compatible : null;
}

function stageForRun(run = {}) {
  const phase = String(run.phase || '').trim();
  if (PHASE_META[phase]) {
    const [id, label] = PHASE_META[phase];
    return { id, label, waiting: id === 'waiting' };
  }
  const lifecycle = lifecycleForRun(run);
  if (lifecycle && LIFECYCLE_META[lifecycle]) {
    const [id, label] = LIFECYCLE_META[lifecycle];
    return { id, label, waiting: false };
  }
  if (run.completedAt) return { id: 'completed', label: 'Completed', waiting: false };
  return { id: 'unknown', label: 'Unknown', waiting: false };
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

function timelineFromRun(run = {}) {
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
      source: 'event',
      stage: event.stage || null,
      round: Number.isInteger(Number(event.round)) ? Number(event.round) : null,
      result: event.result || null,
      headSha: firstString(event.headSha),
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

function latestReviewEvent(run = {}) {
  const candidates = (run.events || [])
    .filter((event) => event && (event.stage || String(event.event || '').includes('review')))
    .filter((event) => Number.isInteger(Number(event.round)) || event.headSha || event.result)
    .sort((a, b) => String(eventTimestamp(b) || '').localeCompare(String(eventTimestamp(a) || '')));
  return candidates[0] || null;
}

function reviewFromRun(run = {}, config = {}) {
  const event = latestReviewEvent(run);
  const stage = firstString(event?.stage, run.reviewStage, run.review?.stage);
  const round = firstNumber(event?.round, run.reviewRound, run.review?.round);
  const limit = stage === 'quick'
    ? Number(config.review?.quickMaxRounds || 0) || null
    : stage
      ? Number(config.review?.fullMaxRounds || config.maxReviewRounds || 0) || null
      : null;
  const headSha = firstString(
    event?.headSha,
    run.currentHeadSha,
    run.review?.headSha,
    run.validationHeadSha,
    run.approvedHeadSha,
  );
  if (!stage && !round && !headSha && run.reviewApproved !== true && run.validationApproved !== true) return null;
  return {
    stage,
    round,
    limit,
    result: event?.result || null,
    headSha,
    validationApproved: run.validationApproved === true,
    validationHeadSha: firstString(run.validationHeadSha),
    reviewApproved: run.reviewApproved === true,
    approvedHeadSha: firstString(run.approvedHeadSha),
  };
}

function nextAction(stage, run = {}) {
  if (run.reason) return String(run.reason);
  const defaults = {
    ready: 'Ready for the next eligible scheduling turn.',
    queued: 'Waiting for coding capacity.',
    waiting: 'Waiting for native GitHub dependencies to clear.',
    coding: 'Coding work is in progress.',
    'review-queued': 'Waiting for PR review capacity.',
    reviewing: 'Pull request review is in progress.',
    'changes-requested': 'Review changes must be addressed.',
    fixing: 'Requested review changes are being fixed.',
    'review-failed': 'Review needs operator attention before it can continue.',
    failed: 'Coding automation needs recovery.',
    'needs-attention': 'Operator attention is required.',
    completed: 'Automation is complete for this recorded run.',
    unknown: 'Open details to inspect the recorded run state.',
  };
  return defaults[stage.id] || defaults.unknown;
}

export function managerWorkQueueItem(run = {}, config = {}) {
  const stage = stageForRun(run);
  const lifecycleLabel = lifecycleForRun(run);
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  return {
    issueNumber,
    title: firstString(run.issueTitle, run.issue?.title) || (issueNumber ? `Issue #${issueNumber}` : 'Recorded issue'),
    issueUrl: firstString(run.issueUrl, run.issue?.url),
    stage: stage.id,
    stageLabel: stage.label,
    lifecycleLabel,
    waitingForDependencies: stage.waiting,
    phase: firstString(run.phase),
    branch: firstString(run.branch),
    attempt: firstNumber(run.attempt),
    workspaceId: firstString(run.workspaceId),
    startedAt: firstString(run.startedAt),
    updatedAt: firstString(run.updatedAt, run.heartbeatAt, run.startedAt),
    completedAt: firstString(run.completedAt),
    reason: firstString(run.reason),
    nextAction: nextAction(stage, run),
    pullRequest: pullRequestFromRun(run),
    review: reviewFromRun(run, config),
    timeline: timelineFromRun(run),
  };
}

function stageCounts(items) {
  const counts = {};
  for (const item of items) counts[item.stage] = (counts[item.stage] || 0) + 1;
  return counts;
}

export function managerWorkQueue(runs = [], config = {}) {
  const items = (runs || [])
    .filter(Boolean)
    .map((run) => managerWorkQueueItem(run, config))
    .filter((item) => item.issueNumber)
    .sort((a, b) => Number(a.issueNumber) - Number(b.issueNumber));
  return {
    items,
    counts: stageCounts(items),
    total: items.length,
    active: items.filter((item) => !['completed', 'failed', 'review-failed', 'needs-attention'].includes(item.stage)).length,
    attention: items.filter((item) => ['failed', 'review-failed', 'needs-attention'].includes(item.stage)).length,
  };
}
