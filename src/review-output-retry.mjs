export const MAX_STRUCTURED_REVIEW_ATTEMPTS = 2;

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function safeSchemaDetail(value, { allowGenericInvalidJson = false } = {}) {
  const raw = text(value);
  if (!raw) return null;
  if (/INVALID_OUTPUT_SCHEMA/i.test(raw)) {
    const parse = /INVALID_OUTPUT_SCHEMA(?:\s*[:\-]?\s*)?([\s\S]*)/i.exec(raw);
    const suffix = text(parse?.[1]);
    return suffix ? `INVALID_OUTPUT_SCHEMA: ${suffix}`.slice(0, 700) : 'INVALID_OUTPUT_SCHEMA';
  }
  const parseJson = /Failed to parse output schema JSON:\s*([^\r\n]+)/i.exec(raw);
  if (parseJson) return `Failed to parse output schema JSON: ${text(parseJson[1])}`.slice(0, 700);
  if (allowGenericInvalidJson) {
    const invalidJson = /returned invalid JSON:\s*([^\r\n]+)/i.exec(raw);
    if (invalidJson) return `returned invalid JSON: ${text(invalidJson[1])}`.slice(0, 700);
  }
  return null;
}

export function structuredReviewSchemaFailureDetail(error) {
  if (!error) return null;
  const command = text(error.command).toLowerCase();
  if (command && command !== 'paseo') return null;

  for (const candidate of [error.stderr, error.stdout]) {
    const detail = safeSchemaDetail(candidate);
    if (detail) return detail;
  }
  if (error.code === 'INVALID_OUTPUT_SCHEMA') return 'INVALID_OUTPUT_SCHEMA';

  const message = text(error.message);
  const schemaDetail = safeSchemaDetail(message);
  if (schemaDetail) return schemaDetail;
  if (/^paseo returned invalid JSON:/i.test(message)) {
    return safeSchemaDetail(message, { allowGenericInvalidJson: true });
  }
  return null;
}

export function reviewRequestIdentity({
  issueNumber,
  pullRequestNumber,
  headSha,
  stage,
  round,
} = {}) {
  const issue = Number(issueNumber);
  const pr = Number(pullRequestNumber);
  const head = text(headSha).toLowerCase();
  const reviewStage = text(stage);
  const reviewRound = Number(round);
  if (!Number.isInteger(issue) || issue < 1
      || !Number.isInteger(pr) || pr < 1
      || !/^[0-9a-f]{7,64}$/i.test(head)
      || !reviewStage
      || !Number.isInteger(reviewRound) || reviewRound < 1) {
    throw new Error('Review request identity requires issue, PR, exact head, stage, and round.');
  }
  return `issue-${issue}:pr-${pr}:${head}:${reviewStage}:round-${reviewRound}`;
}

export function runStructuredReviewWithRetry({
  runReview,
  currentHead,
  expectedHeadSha,
  requestId,
  onRetry = () => {},
  onStale = () => {},
  onExhausted = () => {},
} = {}) {
  if (typeof runReview !== 'function') throw new Error('Structured review runner is required.');
  if (typeof currentHead !== 'function') throw new Error('Current-head reader is required.');
  const expected = text(expectedHeadSha).toLowerCase();
  if (!/^[0-9a-f]{7,64}$/i.test(expected)) throw new Error('Exact review head is required.');
  const identity = text(requestId);
  if (!identity) throw new Error('Review request identity is required.');

  for (let attempt = 1; attempt <= MAX_STRUCTURED_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      return {
        review: runReview({ attempt, requestId: identity }),
        attempts: attempt,
        requestId: identity,
        stale: false,
      };
    } catch (error) {
      const detail = structuredReviewSchemaFailureDetail(error);
      if (!detail) throw error;

      if (attempt >= MAX_STRUCTURED_REVIEW_ATTEMPTS) {
        onExhausted({ attempt, requestId: identity, expectedHeadSha: expected, detail });
        const exhausted = new Error(
          `Reviewer structured output remained invalid after ${attempt} attempts for ${identity} at exact head ${expected}. Last schema error: ${detail}`,
        );
        exhausted.code = 'REVIEW_OUTPUT_SCHEMA_RETRY_EXHAUSTED';
        exhausted.requestId = identity;
        exhausted.headSha = expected;
        throw exhausted;
      }

      const actual = text(currentHead()).toLowerCase();
      if (actual !== expected) {
        onStale({
          attempt,
          requestId: identity,
          expectedHeadSha: expected,
          currentHeadSha: actual || null,
          detail,
        });
        return {
          review: null,
          attempts: attempt,
          requestId: identity,
          stale: true,
          currentHeadSha: actual || null,
          schemaError: detail,
        };
      }

      onRetry({
        attempt: attempt + 1,
        requestId: identity,
        expectedHeadSha: expected,
        detail,
      });
    }
  }

  throw new Error('Structured review retry loop exited unexpectedly.');
}
