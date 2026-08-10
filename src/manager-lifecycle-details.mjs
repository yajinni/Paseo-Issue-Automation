import { reviewEvidenceForRun } from './manager-review-evidence.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { runJson } from './process.mjs';
import { loadConfig, loadIssueLifecycle, loadRun } from './state.mjs';

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function sameSha(left, right) {
  const a = firstString(left)?.toLowerCase();
  const b = firstString(right)?.toLowerCase();
  return Boolean(a && b && a === b);
}

function normalizedResult(value) {
  const raw = firstString(value);
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (['pass', 'passed', 'approved'].includes(key)) return 'Passed';
  if (['changes', 'changes_requested', 'changes requested', 'changes_required'].includes(key)) return 'Changes requested';
  if (key === 'stale') return 'Stale';
  if (['fail', 'failed', 'failure'].includes(key)) return 'Failed';
  return raw;
}

function eventAt(event = {}) {
  return firstString(event.at, event.completedAt, event.updatedAt, event.submittedAt, event.startedAt, event.createdAt);
}

function orderedEvents(events = []) {
  return [...events].filter(Boolean).sort((left, right) => String(eventAt(left) || '').localeCompare(String(eventAt(right) || '')));
}

function firstLifecycleAt(lifecycle, types) {
  const accepted = new Set(types);
  return orderedEvents(lifecycle).find((event) => accepted.has(String(event?.type || '')))?.at || null;
}

function firstLifecycleMatching(lifecycle, pattern) {
  return orderedEvents(lifecycle).find((event) => pattern.test([
    event?.type,
    event?.message,
    event?.detail,
    event?.evidence?.phase,
  ].filter(Boolean).join(' ')))?.at || null;
}

function issueSnapshot(root, issueNumber, jsonRunner = runJson) {
  const result = jsonRunner('gh', [
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,url,state,createdAt,closedAt',
  ], { cwd: root });
  if (!result || Number(result.number) !== Number(issueNumber)) {
    throw new Error(`Could not read GitHub issue #${issueNumber}.`);
  }
  return {
    number: Number(result.number),
    title: firstString(result.title),
    url: firstString(result.url),
    state: firstString(result.state),
    createdAt: firstString(result.createdAt),
    closedAt: firstString(result.closedAt),
  };
}

function plannedReviewTypes(config = {}) {
  const workflow = String(config.review?.workflow || '');
  if (workflow === 'quick-web-chatgpt') return ['light', 'chatgpt'];
  if (workflow === 'full-immediate') return ['heavy'];
  if (workflow === 'quick-manual') return ['light'];
  return [];
}

function reviewTypeForEvent(event = {}, run = {}) {
  const stage = String(event.stage || '').toLowerCase();
  const source = String(event.source || '').toLowerCase();
  const runtime = String(run.reviewRuntimeStage || run.review?.runtimeStage || '').toLowerCase();
  const web = Boolean(event.conversationUrl)
    || source.includes('browser')
    || source.includes('chatgpt')
    || stage === 'web-chatgpt'
    || runtime === 'full-web-chatgpt' && stage === 'full';
  if (web) return 'chatgpt';
  if (stage === 'full') return 'heavy';
  if (stage === 'quick') return 'light';
  return null;
}

function normalizedFinding(finding = {}) {
  const message = firstString(finding.message);
  if (!message) return null;
  return {
    severity: String(finding.severity || '').toLowerCase() === 'non-blocking' ? 'non-blocking' : 'blocking',
    message,
    file: firstString(finding.file),
    line: Number.isInteger(Number(finding.line)) ? Number(finding.line) : null,
    requiredChange: firstString(finding.requiredChange),
    requiredTest: firstString(finding.requiredTest),
  };
}

function findingsFor(event = {}) {
  return (Array.isArray(event.findings) ? event.findings : []).map(normalizedFinding).filter(Boolean);
}

function findingCounts(findings = []) {
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const nonBlocking = findings.filter((finding) => finding.severity === 'non-blocking').length;
  return { blocking, nonBlocking, total: blocking + nonBlocking };
}

function reviewLabel(type) {
  if (type === 'light') return 'Light Review';
  if (type === 'heavy') return 'Heavy PR Review';
  if (type === 'chatgpt') return 'ChatGPT Review';
  return 'Review';
}

function reviewLimit(type, config = {}) {
  if (type === 'light') return Number(config.review?.quickMaxRounds || 0) || null;
  return Number(config.review?.fullMaxRounds || config.maxReviewRounds || 0) || null;
}

function baseReviewCard(type, config) {
  const browser = type === 'chatgpt';
  return {
    type,
    label: reviewLabel(type),
    configured: plannedReviewTypes(config).includes(type),
    performed: false,
    model: browser ? null : firstString(config.models?.reviewer),
    thinking: browser ? null : firstString(config.models?.reviewerThinking),
    channel: browser ? 'Web ChatGPT (Browser)' : firstString(config.codingHarness) || 'Provider/Coding Harness',
    startedAt: null,
    completedAt: null,
    round: null,
    limit: reviewLimit(type, config),
    result: null,
    exactHeadSha: null,
    summary: null,
    findings: [],
    findingCounts: { blocking: 0, nonBlocking: 0, total: 0 },
    conversationUrl: null,
    reviewJobId: null,
    reviewRequestId: null,
    attempts: null,
  };
}

function mergeReviewEvent(card, event, config) {
  const findings = findingsFor(event);
  return {
    ...card,
    configured: true,
    performed: true,
    model: card.type === 'chatgpt' ? null : firstString(event.model, card.model, config.models?.reviewer),
    thinking: card.type === 'chatgpt' ? null : firstString(event.thinking, card.thinking, config.models?.reviewerThinking),
    startedAt: card.startedAt || firstString(event.startedAt, event.requestedAt),
    completedAt: eventAt(event) || card.completedAt,
    round: firstNumber(event.round, card.round),
    result: normalizedResult(event.result) || card.result,
    exactHeadSha: firstString(event.headSha, event.commit, card.exactHeadSha),
    summary: firstString(event.summary, event.details, card.summary),
    findings: findings.length ? findings : card.findings,
    findingCounts: findings.length ? findingCounts(findings) : card.findingCounts,
    conversationUrl: firstString(event.conversationUrl, card.conversationUrl),
  };
}

function mergeCurrentReviewEvidence(card, evidence) {
  if (!evidence) return card;
  const evidenceType = evidence.type === 'web-chatgpt' ? 'chatgpt' : evidence.type;
  if (evidenceType !== card.type) return card;
  const evidenceHead = firstString(evidence.exactHeadSha, evidence.currentHeadSha);
  const cardHead = firstString(card.exactHeadSha);
  const replacesDifferentHead = Boolean(evidenceHead && cardHead && !sameSha(evidenceHead, cardHead));
  const previous = replacesDifferentHead
    ? {
        performed: false,
        startedAt: null,
        completedAt: null,
        round: null,
        result: null,
        exactHeadSha: null,
        summary: null,
        findings: [],
        conversationUrl: null,
      }
    : card;
  const findings = Array.isArray(evidence.findings) ? evidence.findings : previous.findings;
  return {
    ...card,
    configured: true,
    performed: previous.performed || Boolean(evidence.completedAt || evidence.result || evidence.jobId),
    startedAt: firstString(previous.startedAt, evidence.requestedAt, evidence.submittedAt),
    completedAt: firstString(evidence.completedAt, previous.completedAt),
    round: firstNumber(evidence.round, previous.round),
    limit: firstNumber(evidence.limit, card.limit),
    result: normalizedResult(evidence.result) || previous.result,
    exactHeadSha: firstString(evidenceHead, previous.exactHeadSha),
    summary: firstString(evidence.summary, previous.summary),
    findings,
    findingCounts: evidence.findingCounts || findingCounts(findings),
    conversationUrl: firstString(evidence.conversationUrl, previous.conversationUrl),
    reviewJobId: firstString(evidence.jobId),
    reviewRequestId: firstString(evidence.reviewRequestId),
    attempts: Number.isInteger(Number(evidence.attempts)) ? Number(evidence.attempts) : null,
  };
}

function reviewCards(run, store, config) {
  const cards = new Map();
  for (const type of plannedReviewTypes(config)) cards.set(type, baseReviewCard(type, config));

  const reviewEvents = orderedEvents(run.events || []).filter((event) => ['harness-review', 'review'].includes(String(event?.event || '')));
  for (const event of reviewEvents) {
    const type = reviewTypeForEvent(event, run);
    if (!type) continue;
    cards.set(type, mergeReviewEvent(cards.get(type) || baseReviewCard(type, config), event, config));
  }

  let currentEvidence = null;
  try { currentEvidence = reviewEvidenceForRun(run, store, config); } catch {}
  if (currentEvidence) {
    const type = currentEvidence.type === 'web-chatgpt' ? 'chatgpt' : currentEvidence.type;
    if (['light', 'heavy', 'chatgpt'].includes(type)) {
      cards.set(type, mergeCurrentReviewEvidence(cards.get(type) || baseReviewCard(type, config), currentEvidence));
    }
  }

  return ['light', 'heavy', 'chatgpt'].map((type) => cards.get(type)).filter(Boolean);
}

function safeReviewStore(root, loader = loadPrReviewStore) {
  try { return loader(root); } catch { return null; }
}

function claimedDetails(run, lifecycle, issue) {
  const claimedAt = firstLifecycleAt(lifecycle, ['run-created'])
    || firstLifecycleMatching(lifecycle, /attempt-launching|claimed|queued/i)
    || firstString(run.claimedAt, run.startedAt);
  return {
    issueCreatedAt: issue.createdAt,
    claimedAt,
    claimedBy: 'Paseo Automation',
    explanation: 'Paseo selected this issue for processing and placed it in the queue to be passed to a coding agent.',
    nextStep: 'Pass the claimed issue to a coding agent when coding capacity is available.',
  };
}

function codingDetails(run, lifecycle, config) {
  const startedAt = firstLifecycleAt(lifecycle, ['agent-started', 'agent-start-reconciled'])
    || firstLifecycleMatching(lifecycle, /coding started|agent-started/i);
  const completedAt = firstLifecycleAt(lifecycle, ['pr-review-queued'])
    || firstLifecycleMatching(lifecycle, /coding completed|pr-review-queued|draft pr|pull request.*opened/i);
  const phase = String(run.phase || '');
  const status = completedAt
    ? 'Completed'
    : startedAt || phase === 'coding'
      ? 'In progress'
      : 'Waiting for coding agent';
  return {
    model: firstString(run.coderModel, run.coding?.model, config.models?.coder),
    thinking: firstString(run.coderThinking, run.coding?.thinking, config.models?.coderThinking),
    harness: firstString(run.codingHarness, run.coding?.harness, config.codingHarness),
    agentId: firstString(run.coderAgentId, run.agentId),
    startedAt,
    completedAt,
    lastActivityAt: firstString(run.heartbeatAt, run.updatedAt),
    status,
    branch: firstString(run.branch),
    workspaceId: firstString(run.workspaceId),
  };
}

function completionDetails(run, issue, config) {
  const prNumber = firstNumber(run.prNumber, run.pullRequestNumber, run.pullRequest?.number);
  return {
    prNumber,
    prUrl: firstString(run.prUrl, run.pullRequestUrl, run.pullRequest?.url),
    baseBranch: firstString(config.baseBranch),
    mergedAt: firstString(run.mergedAt),
    mergedHeadSha: firstString(run.mergedHeadSha, run.approvedHeadSha, run.approvedCommit),
    issueClosedAt: issue.closedAt,
    issueClosureVerifiedAt: firstString(run.issueClosureVerifiedAt),
    completedAt: firstString(run.completedAt),
    finalStatus: firstString(run.status),
    complete: Boolean(run.completedAt && (run.issueClosureVerifiedAt || issue.closedAt)),
  };
}

export function managerLifecycleDetails(root, issueNumber, {
  jsonRunner = runJson,
  runLoader = loadRun,
  lifecycleLoader = loadIssueLifecycle,
  configLoader = loadConfig,
  reviewStoreLoader = loadPrReviewStore,
} = {}) {
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error('A positive issue number is required.');
  const run = runLoader(root, number);
  if (!run) throw new Error(`No recorded automation run exists for issue #${number}.`);
  const lifecycle = lifecycleLoader(root, number, { limit: 500 }) || [];
  const config = configLoader(root) || {};
  const store = safeReviewStore(root, reviewStoreLoader);
  const issue = issueSnapshot(root, number, jsonRunner);

  return {
    issueNumber: number,
    issue: {
      title: issue.title || firstString(run.issueTitle) || `Issue #${number}`,
      url: issue.url || firstString(run.issueUrl),
      state: issue.state,
    },
    claimed: claimedDetails(run, lifecycle, issue),
    coding: codingDetails(run, lifecycle, config),
    reviews: reviewCards(run, store, config),
    completed: completionDetails(run, issue, config),
  };
}

export function managerLifecycleDetailsApiRequest({ method, pathname }, context, options = {}) {
  const match = String(pathname || '').match(/^\/api\/issues\/(\d+)\/lifecycle-details$/);
  if (!match) return null;
  if (method !== 'GET') {
    return { handled: true, status: 405, body: { error: 'Lifecycle details are read-only.' } };
  }
  const reader = options.lifecycleDetailsReader || managerLifecycleDetails;
  try {
    return {
      handled: true,
      status: 200,
      body: { lifecycleDetails: reader(context.root, Number(match[1]), options.lifecycleDetailsOptions || {}) },
    };
  } catch (error) {
    return {
      handled: true,
      status: 404,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
