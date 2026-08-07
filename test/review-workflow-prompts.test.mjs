import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_REVIEW_PROMPT_TEMPLATE,
  QUICK_REVIEW_PROMPT_TEMPLATE,
  REVIEW_STAGES,
  REVIEW_WORKFLOW_OUTPUT_SCHEMA,
  REVIEW_WORKFLOW_PROMPT_VERSION,
  renderReviewWorkflowPrompt,
  reviewPromptPreview,
} from '../src/review-workflow-prompts.mjs';
import { validateRepositoryConfig } from '../src/setup-wizard/schema.mjs';

const baseInput = {
  repository: 'owner/repo',
  pullRequestNumber: 42,
  issueNumber: 17,
  headSha: 'abcdef1234567890',
  round: 1,
  issueContext: 'Acceptance criteria: preserve behavior.',
  changeContext: 'src/example.mjs changed.',
  validationContext: 'npm test passed.',
};

test('quick prompt is narrow, exact-head bound, and injection resistant', () => {
  const prompt = renderReviewWorkflowPrompt({ ...baseInput, stage: REVIEW_STAGES.quick });
  assert.match(prompt, /This is a QUICK review/);
  assert.match(prompt, /Do not claim this is a broad architecture review/);
  assert.match(prompt, /untrusted review material/i);
  assert.match(prompt, /abcdef1234567890/);
  assert.match(prompt, /Review stage: quick/);
  assert.doesNotMatch(prompt, /\{\{repository\}\}/);
});

test('full prompt covers surrounding code, security, compatibility, migration, and test sufficiency', () => {
  const prompt = renderReviewWorkflowPrompt({
    ...baseInput,
    stage: REVIEW_STAGES.full,
    quickFindings: 'Potential edge case in parser.',
  });
  for (const phrase of [
    'surrounding',
    'security',
    'compatibility',
    'migration',
    'test sufficiency',
    'Re-evaluate them independently',
  ]) assert.match(prompt, new RegExp(phrase, 'i'));
  assert.match(prompt, /Review stage: full/);
});

test('prompt previews are versioned, copyable, and not editable', () => {
  const quick = reviewPromptPreview(REVIEW_STAGES.quick);
  const full = reviewPromptPreview(REVIEW_STAGES.full);
  assert.equal(quick.promptVersion, REVIEW_WORKFLOW_PROMPT_VERSION);
  assert.equal(quick.copyable, true);
  assert.equal(quick.editable, false);
  assert.equal(quick.template, QUICK_REVIEW_PROMPT_TEMPLATE);
  assert.equal(full.template, FULL_REVIEW_PROMPT_TEMPLATE);
  assert.equal(full.outputSchema, REVIEW_WORKFLOW_OUTPUT_SCHEMA);
});

test('machine-readable review result is tied to repository, PR, issue, SHA, stage, round, and version', () => {
  const schema = JSON.parse(REVIEW_WORKFLOW_OUTPUT_SCHEMA);
  for (const field of [
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
  ]) assert.ok(schema.required.includes(field), `${field} must be required`);
  assert.deepEqual(schema.properties.result.enum, ['pass', 'changes', 'stale']);
  assert.equal(schema.properties.findings.items.properties.message.minLength, 1);
});

test('quick and full review limits accept 20 and reject 21 independently', () => {
  const valid = validateRepositoryConfig({
    version: 3,
    review: {
      workflow: 'quick-manual',
      quickMaxRounds: 20,
      fullMaxRounds: 20,
    },
  });
  assert.equal(valid.review.quickMaxRounds, 20);
  assert.equal(valid.review.fullMaxRounds, 20);
  assert.throws(() => validateRepositoryConfig({
    version: 3,
    review: { quickMaxRounds: 21, fullMaxRounds: 3 },
  }), /1 through 20/);
  assert.throws(() => validateRepositoryConfig({
    version: 3,
    review: { quickMaxRounds: 3, fullMaxRounds: 21 },
  }), /1 through 20/);
});

test('review prompt metadata validation rejects stale/ambiguous identifiers before rendering', () => {
  assert.throws(() => renderReviewWorkflowPrompt({ ...baseInput, stage: 'wide' }), /Unsupported review stage/);
  assert.throws(() => renderReviewWorkflowPrompt({ ...baseInput, stage: REVIEW_STAGES.quick, headSha: 'not-a-sha' }), /head SHA/);
  assert.throws(() => renderReviewWorkflowPrompt({ ...baseInput, stage: REVIEW_STAGES.quick, round: 21 }), /1 through 20/);
});
