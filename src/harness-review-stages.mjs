import {
  REVIEW_STAGES,
  REVIEW_WORKFLOW_PROMPT_VERSION,
  REVIEW_WORKFLOW_RESULTS,
} from './review-workflow-prompts.mjs';

export const HARNESS_RUNTIME_STAGES = Object.freeze({
  quick: 'quick',
  fullImmediate: 'full-immediate',
  fullManual: 'full-manual',
  fullWebChatgpt: 'full-web-chatgpt',
});

export const HARNESS_REVIEW_EVENTS = Object.freeze({
  result: 'harness-review',
  repair: 'harness-review-repair',
  handoff: 'harness-review-handoff',
});

function workflow(config = {}) {
  return String(config.review?.workflow || 'full-immediate');
}

export function harnessRuntimeStage(config = {}) {
  return workflow(config) === 'full-immediate'
    ? HARNESS_RUNTIME_STAGES.fullImmediate
    : HARNESS_RUNTIME_STAGES.quick;
}

export function harnessReviewStage(config = {}) {
  return harnessRuntimeStage(config) === HARNESS_RUNTIME_STAGES.quick
    ? REVIEW_STAGES.quick
    : REVIEW_STAGES.full;
}

export function harnessReviewRoundLimit(config = {}, stage = harnessReviewStage(config)) {
  const value = stage === REVIEW_STAGES.quick
    ? Number(config.review?.quickMaxRounds)
    : Number(config.review?.fullMaxRounds ?? config.maxReviewRounds);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`Maximum ${stage}-review rounds must be an integer from 1 through 20.`);
  }
  return value;
}

export function nextReviewRound(state = {}, stage) {
  const completed = (state.events || []).filter((event) => (
    event.event === HARNESS_REVIEW_EVENTS.result && event.stage === stage
  ));
  return completed.length + 1;
}

export function unresolvedQuickFindings(state = {}) {
  return (state.events || [])
    .filter((event) => (
      event.event === HARNESS_REVIEW_EVENTS.result
      && event.stage === REVIEW_STAGES.quick
      && event.result === 'changes'
    ))
    .flatMap((event) => Array.isArray(event.findings) ? event.findings : [])
    .filter((finding) => finding && finding.severity === 'blocking');
}

export function quickExhaustionHandoff(config = {}) {
  const selected = workflow(config);
  if (selected === 'quick-manual') return HARNESS_RUNTIME_STAGES.fullManual;
  if (selected === 'quick-web-chatgpt') return HARNESS_RUNTIME_STAGES.fullWebChatgpt;
  return null;
}

export function reviewFreshness({ requestedHeadSha, currentHeadSha, requestedBaseSha = null, currentBaseSha = null } = {}) {
  const expectedHead = String(requestedHeadSha || '').trim();
  const actualHead = String(currentHeadSha || '').trim();
  if (!expectedHead || !actualHead || expectedHead !== actualHead) {
    return { fresh: false, reason: 'head-changed' };
  }
  if (requestedBaseSha !== null && currentBaseSha !== null
      && String(requestedBaseSha) !== String(currentBaseSha)) {
    return { fresh: false, reason: 'base-changed' };
  }
  return { fresh: true, reason: null };
}

export function reviewStageDecision({ config = {}, state = {}, stage, verdict }) {
  if (!Object.values(REVIEW_STAGES).includes(stage)) throw new Error(`Unsupported review stage: ${stage}.`);
  if (!verdict || !REVIEW_WORKFLOW_RESULTS.includes(verdict.result)) {
    throw new Error('Reviewer did not return a supported result.');
  }
  if (verdict.result === 'stale') return { action: 'stale' };
  if (verdict.result === 'pass') return {
    action: stage === REVIEW_STAGES.quick ? 'quick-passed' : 'full-passed',
  };

  const round = nextReviewRound(state, stage);
  const limit = harnessReviewRoundLimit(config, stage);
  if (round < limit) return { action: 'repair', round, limit };

  if (stage === REVIEW_STAGES.quick) {
    return {
      action: 'handoff',
      target: quickExhaustionHandoff(config),
      round,
      limit,
      needsAttention: false,
    };
  }
  return {
    action: 'attention',
    round,
    limit,
    changesRequested: true,
    needsAttention: true,
  };
}

export function validateHarnessReviewVerdict(verdict, expected = {}) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
    throw new Error('Reviewer did not return the required structured verdict.');
  }
  const requiredFields = [
    'repository',
    'pullRequestNumber',
    'issueNumber',
    'headSha',
    'stage',
    'round',
    'promptVersion',
    'result',
    'summary',
    'findings',
  ];
  const missing = requiredFields.filter((field) => !Object.hasOwn(verdict, field));
  if (missing.length) {
    throw new Error(`Reviewer did not return the required structured verdict fields: ${missing.join(', ')}.`);
  }
  if (typeof verdict.repository !== 'string' || !verdict.repository.trim()
      || !Number.isInteger(verdict.pullRequestNumber) || verdict.pullRequestNumber < 1
      || !Number.isInteger(verdict.issueNumber) || verdict.issueNumber < 1
      || !/^[0-9a-f]{7,64}$/i.test(String(verdict.headSha || ''))
      || !Object.values(REVIEW_STAGES).includes(verdict.stage)
      || !Number.isInteger(verdict.round) || verdict.round < 1 || verdict.round > 20
      || !Number.isInteger(verdict.promptVersion) || verdict.promptVersion < 1
      || typeof verdict.summary !== 'string'
      || !Array.isArray(verdict.findings)) {
    throw new Error('Reviewer did not return the required structured verdict shape.');
  }
  const checks = [
    ['repository', String(expected.repository || '')],
    ['pullRequestNumber', Number(expected.pullRequestNumber)],
    ['issueNumber', Number(expected.issueNumber)],
    ['headSha', String(expected.headSha || '')],
    ['stage', String(expected.stage || '')],
    ['round', Number(expected.round)],
    ['promptVersion', Number(expected.promptVersion ?? REVIEW_WORKFLOW_PROMPT_VERSION)],
  ];
  for (const [field, value] of checks) {
    if (verdict[field] !== value) {
      const error = new Error(`Reviewer verdict ${field} does not match the requested review.`);
      error.code = 'REVIEW_METADATA_MISMATCH';
      error.command = 'paseo';
      throw error;
    }
  }
  if (!REVIEW_WORKFLOW_RESULTS.includes(verdict.result)) throw new Error('Reviewer verdict result is invalid.');
  return verdict;
}

export function createHarnessReviewEvent(verdict, expected = {}, { at = new Date().toISOString() } = {}) {
  validateHarnessReviewVerdict(verdict, expected);
  return Object.freeze({
    event: HARNESS_REVIEW_EVENTS.result,
    stage: verdict.stage,
    round: verdict.round,
    result: verdict.result,
    headSha: verdict.headSha,
    promptVersion: verdict.promptVersion,
    summary: String(verdict.summary || ''),
    findings: verdict.findings.map((finding) => ({ ...finding })),
    at,
  });
}

export function invalidateAfterRepair(state = {}, {
  previousHeadSha,
  newHeadSha,
  at = new Date().toISOString(),
} = {}) {
  const previous = String(previousHeadSha || state.currentHeadSha || '').trim();
  const next = String(newHeadSha || '').trim();
  if (!previous || !next || previous === next) {
    throw new Error('A repair must produce a new exact PR head SHA.');
  }
  return {
    ...state,
    currentHeadSha: next,
    validationApproved: false,
    validationHeadSha: null,
    reviewApproved: false,
    approvedHeadSha: null,
    events: [
      ...(state.events || []),
      {
        event: HARNESS_REVIEW_EVENTS.repair,
        previousHeadSha: previous,
        newHeadSha: next,
        invalidatedValidation: true,
        invalidatedReviewApproval: true,
        at,
      },
    ],
  };
}

export function createQuickHandoffEvent(config = {}, state = {}, {
  at = new Date().toISOString(),
} = {}) {
  const target = quickExhaustionHandoff(config);
  if (!target) throw new Error('Quick-review handoff requires a quick review workflow.');
  return Object.freeze({
    event: HARNESS_REVIEW_EVENTS.handoff,
    from: HARNESS_RUNTIME_STAGES.quick,
    to: target,
    unresolvedFindings: unresolvedQuickFindings(state).map((finding) => ({ ...finding })),
    needsAttention: false,
    at,
  });
}

export function summarizeReviewFindings(verdict = {}) {
  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  if (!findings.length) return String(verdict.summary || '').trim() || 'No findings reported.';
  return findings.map((finding, index) => {
    const location = finding.file
      ? `${finding.file}${Number.isInteger(finding.line) ? `:${finding.line}` : ''}`
      : 'general';
    const required = finding.requiredChange ? ` Required change: ${finding.requiredChange}` : '';
    const test = finding.requiredTest ? ` Required test: ${finding.requiredTest}` : '';
    return `${index + 1}. [${finding.severity}] ${location}: ${finding.message}${required}${test}`;
  }).join('\n');
}
