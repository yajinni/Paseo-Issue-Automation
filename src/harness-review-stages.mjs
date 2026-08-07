import {
  REVIEW_STAGES,
  REVIEW_WORKFLOW_PROMPT_VERSION,
  REVIEW_WORKFLOW_RESULTS,
} from './review-workflow-prompts.mjs';

export const HARNESS_REVIEW_EVENTS = Object.freeze({
  result: 'harness-review',
  handoff: 'harness-review-handoff',
});

function workflow(config = {}) {
  return String(config.review?.workflow || 'full-immediate');
}

export function harnessReviewStage(config = {}) {
  return workflow(config) === 'full-immediate' ? REVIEW_STAGES.full : REVIEW_STAGES.quick;
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
      && event.result === 'CHANGES_REQUIRED'
    ))
    .flatMap((event) => Array.isArray(event.findings) ? event.findings : [])
    .filter((finding) => finding && finding.severity === 'blocking');
}

export function quickExhaustionHandoff(config = {}) {
  const selected = workflow(config);
  if (selected === 'quick-manual') return 'manual';
  if (selected === 'quick-web-chatgpt') return 'web-chatgpt';
  return null;
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
    };
  }
  return { action: 'attention', round, limit };
}

export function validateHarnessReviewVerdict(verdict, expected = {}) {
  if (!verdict || typeof verdict !== 'object') throw new Error('Reviewer did not return a structured verdict.');
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
    if (verdict[field] !== value) throw new Error(`Reviewer verdict ${field} does not match the requested review.`);
  }
  if (!REVIEW_WORKFLOW_RESULTS.includes(verdict.result)) throw new Error('Reviewer verdict result is invalid.');
  if (!Array.isArray(verdict.findings)) throw new Error('Reviewer verdict findings must be an array.');
  return verdict;
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
