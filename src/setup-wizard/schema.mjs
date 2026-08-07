export const REPOSITORY_CONFIG_VERSION = 3;

export const ISSUE_SELECTION_MODES = Object.freeze([
  'recommended-labels',
  'all-open',
]);

export const REVIEW_WORKFLOWS = Object.freeze([
  'quick-manual',
  'quick-web-chatgpt',
  'full-immediate',
]);

export const DEFAULT_REPOSITORY_CONFIG = Object.freeze({
  version: REPOSITORY_CONFIG_VERSION,
  setupComplete: false,
  baseBranch: '',
  pollIntervalSeconds: 120,
  maxActive: 1,
  codingHarness: '',
  issueSelection: Object.freeze({
    mode: 'recommended-labels',
    excludedLabels: Object.freeze([]),
    temporaryFailureRetries: 3,
  }),
  review: Object.freeze({
    workflow: 'quick-manual',
    quickMaxRounds: 3,
    fullMaxRounds: 3,
    autoMergeApproved: false,
  }),
  controller: Object.freeze({ type: 'deterministic' }),
  models: Object.freeze({
    orchestrator: '',
    coder: '',
    coderThinking: '',
    reviewer: '',
    reviewerThinking: '',
  }),
  workspace: Object.freeze({ id: null, title: 'Issue Coding Automation' }),
});

function normalizedInteger(value, fallback, min, max, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}.`);
  }
  return number;
}

function normalizedChoice(value, fallback, choices, label) {
  const selection = String(value ?? fallback).trim();
  if (!choices.includes(selection)) {
    throw new Error(`${label} must be one of: ${choices.join(', ')}.`);
  }
  return selection;
}

function normalizedIdentifier(value, label, maxLength = 200) {
  const selection = String(value || '').trim();
  if (!selection) return '';
  if (selection.length > maxLength || /\s/.test(selection)) {
    throw new Error(`${label} must be a valid identifier.`);
  }
  return selection;
}

function normalizedModel(value, label) {
  const selection = normalizedIdentifier(value, label, 240);
  if (selection && !selection.includes('/')) {
    throw new Error(`${label} must use Paseo's provider/model form.`);
  }
  return selection;
}

function normalizedThinking(value, label) {
  const selection = String(value || '').trim();
  if (!selection) return '';
  if (selection.length > 100 || /\s/.test(selection)) {
    throw new Error(`${label} must be a valid Paseo thinking option ID.`);
  }
  return selection;
}

function normalizedBranch(value) {
  const branch = String(value || '').trim();
  if (!branch) return '';
  if (branch.length > 200 || /\s|\.\.|@\{|\\|~|\^|:|\?|\*|\[/.test(branch)) {
    throw new Error('Base branch is not a safe Git branch name.');
  }
  return branch;
}

function normalizedLabels(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Excluded issue labels must be an array.');
  return [...new Set(value.map((label) => String(label || '').trim()).filter(Boolean))]
    .map((label) => {
      if (label.length > 100 || /[\r\n]/.test(label)) throw new Error('Excluded issue labels must be valid GitHub label names.');
      return label;
    })
    .sort((left, right) => left.localeCompare(right));
}

function legacyVersion(input) {
  const version = Number(input?.version ?? 2);
  if (!Number.isInteger(version) || version < 1 || version > REPOSITORY_CONFIG_VERSION) {
    throw new Error(`Unsupported repository configuration version: ${input?.version}.`);
  }
  return version;
}

export function validateRepositoryConfig(input = {}, { workspaceTitle = 'Issue Coding Automation' } = {}) {
  const sourceVersion = legacyVersion(input);
  const legacy = sourceVersion < REPOSITORY_CONFIG_VERSION;
  const coder = normalizedModel(input.models?.coder, 'Coder model');
  const reviewer = normalizedModel(input.models?.reviewer, 'Reviewer model');
  const coderThinking = normalizedThinking(input.models?.coderThinking, 'Coder thinking level');
  const reviewerThinking = normalizedThinking(input.models?.reviewerThinking, 'Reviewer thinking level');
  const legacyOrchestrator = normalizedModel(input.models?.orchestrator, 'Legacy Orchestrator model') || coder;
  const fullRoundsFallback = legacy
    ? normalizedInteger(input.maxReviewRounds, 4, 1, 20, 'Maximum review rounds')
    : 3;

  const review = {
    workflow: normalizedChoice(
      input.review?.workflow,
      legacy ? 'full-immediate' : DEFAULT_REPOSITORY_CONFIG.review.workflow,
      REVIEW_WORKFLOWS,
      'Review workflow',
    ),
    quickMaxRounds: normalizedInteger(
      input.review?.quickMaxRounds,
      DEFAULT_REPOSITORY_CONFIG.review.quickMaxRounds,
      1,
      20,
      'Maximum quick-review rounds',
    ),
    fullMaxRounds: normalizedInteger(
      input.review?.fullMaxRounds ?? (legacy ? input.maxReviewRounds : undefined),
      fullRoundsFallback,
      1,
      20,
      'Maximum full-review rounds',
    ),
    autoMergeApproved: input.review?.autoMergeApproved === true,
  };

  return {
    version: REPOSITORY_CONFIG_VERSION,
    setupComplete: input.setupComplete === true,
    baseBranch: normalizedBranch(input.baseBranch),
    pollIntervalSeconds: normalizedInteger(input.pollIntervalSeconds, 120, 60, 3600, 'Polling interval'),
    maxActive: normalizedInteger(input.maxActive, 1, 1, 20, 'Maximum active issues'),
    codingHarness: normalizedIdentifier(input.codingHarness, 'Coding harness'),
    issueSelection: {
      mode: normalizedChoice(
        input.issueSelection?.mode,
        DEFAULT_REPOSITORY_CONFIG.issueSelection.mode,
        ISSUE_SELECTION_MODES,
        'Issue selection mode',
      ),
      excludedLabels: normalizedLabels(input.issueSelection?.excludedLabels),
      temporaryFailureRetries: normalizedInteger(
        input.issueSelection?.temporaryFailureRetries,
        DEFAULT_REPOSITORY_CONFIG.issueSelection.temporaryFailureRetries,
        0,
        20,
        'Temporary failure retries',
      ),
    },
    review,
    // Compatibility alias for legacy runtime/UI consumers. New code should use review.fullMaxRounds.
    maxReviewRounds: review.fullMaxRounds,
    controller: { type: 'deterministic' },
    models: {
      // Retained for read compatibility until the dedicated legacy cleanup PR.
      orchestrator: legacyOrchestrator,
      coder,
      coderThinking,
      reviewer,
      reviewerThinking,
    },
    workspace: {
      id: input.workspace?.id ? String(input.workspace.id) : null,
      title: workspaceTitle,
    },
  };
}

export function mergeRepositoryConfig(current, patch = {}) {
  return {
    ...current,
    ...patch,
    issueSelection: {
      ...current.issueSelection,
      ...(patch.issueSelection || {}),
    },
    review: {
      ...current.review,
      ...(patch.review || {}),
    },
    models: {
      ...current.models,
      ...(patch.models || {}),
    },
    workspace: {
      ...current.workspace,
      ...(patch.workspace || {}),
    },
  };
}
