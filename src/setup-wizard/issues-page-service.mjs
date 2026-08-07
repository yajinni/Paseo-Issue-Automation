import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE_LABEL_CATALOG, PASEO_LABELS } from '../label-catalog.mjs';
import { runJson as defaultRunJson } from '../process.mjs';
import { ISSUE_SELECTION_MODES } from './schema.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLED_TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/automated-coding-task.md';
const SOURCE_TEMPLATE_PATH = path.join(PACKAGE_ROOT, 'templates', 'automated-coding-task.md');

function activeSession(options) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function selections(session) {
  const value = session.pages?.issues?.selections || {};
  return {
    mode: ISSUE_SELECTION_MODES.includes(value.mode) ? value.mode : 'recommended-labels',
    maxActive: Number.isInteger(Number(value.maxActive)) ? Number(value.maxActive) : 1,
    temporaryFailureRetries: Number.isInteger(Number(value.temporaryFailureRetries)) ? Number(value.temporaryFailureRetries) : 3,
    excludedLabels: Array.isArray(value.excludedLabels)
      ? [...new Set(value.excludedLabels.map((label) => String(label || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      : [],
  };
}

function repositorySelection(session) {
  const value = session.pages?.repository?.selections || {};
  return {
    repository: String(value.repository || session.repository?.nameWithOwner || '').trim(),
    baseBranch: String(value.baseBranch || session.baseBranch || '').trim(),
    host: String(value.host || 'github.com').trim() || 'github.com',
  };
}

function checkoutSelection(session) {
  const repository = session.pages?.repository?.selections || {};
  const legacy = session.pages?.checkout?.selections || {};
  return String(repository.checkoutPath || legacy.checkoutPath || session.managedCheckoutChoice || '').trim();
}

function normalizeLabelList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    name: String(item?.name || '').trim(),
    color: String(item?.color || '').replace(/^#/, ''),
    description: item?.description == null ? '' : String(item.description),
  })).filter((item) => item.name);
}

function loadRepositoryLabels(repository, options = {}) {
  const runJson = options.runJson || defaultRunJson;
  const labels = runJson('gh', [
    'label', 'list',
    '--repo', repository,
    '--limit', '1000',
    '--json', 'name,color,description',
  ], {
    env: options.env,
    timeoutMs: options.timeoutMs || 30_000,
  });
  if (!Array.isArray(labels)) throw new Error('GitHub did not return a label catalog.');
  return normalizeLabelList(labels);
}

function normalizeTemplate(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function loadBundledTemplateContent(options = {}) {
  const readFile = options.readFileSync || readFileSync;
  const sourcePath = options.sourceTemplatePath || SOURCE_TEMPLATE_PATH;
  return normalizeTemplate(readFile(sourcePath, 'utf8'));
}

function loadTemplatePreview(checkoutPath, options = {}) {
  const fileExists = options.existsSync || existsSync;
  const readFile = options.readFileSync || readFileSync;
  const source = loadBundledTemplateContent(options);
  if (!checkoutPath) {
    return {
      path: INSTALLED_TEMPLATE_PATH,
      status: 'bundled',
      setupPrChangeRequired: true,
      message: 'Bundled automation issue template preview.',
      content: source,
    };
  }
  const targetPath = path.join(checkoutPath, INSTALLED_TEMPLATE_PATH);
  if (!fileExists(targetPath)) {
    return {
      path: INSTALLED_TEMPLATE_PATH,
      status: 'missing',
      setupPrChangeRequired: true,
      message: 'The automation issue template will be added through the reviewed setup pull request.',
      content: source,
    };
  }
  const current = normalizeTemplate(readFile(targetPath, 'utf8'));
  const same = current === source;
  return {
    path: INSTALLED_TEMPLATE_PATH,
    status: same ? 'current' : 'update',
    setupPrChangeRequired: !same,
    message: same
      ? 'The installed automation issue template already matches this package version.'
      : 'The installed automation issue template differs and will be updated through the reviewed setup pull request.',
    content: source,
  };
}

export function buildIssueInstallationPreview({ repository, checkoutPath }, options = {}) {
  if (!repository) throw new Error('Choose a GitHub repository before previewing issue setup.');

  let existingLabels = [];
  let labelPreviewError = null;
  try {
    existingLabels = (options.labelLoader || loadRepositoryLabels)(repository, options);
  } catch (error) {
    labelPreviewError = String(error?.message || error);
  }

  const byName = new Map(existingLabels.map((label) => [label.name, label]));
  const labels = Object.values(LIFECYCLE_LABEL_CATALOG).map((managed) => {
    const existing = byName.get(managed.name) || null;
    return {
      name: managed.name,
      desiredColor: managed.color,
      desiredDescription: managed.description,
      status: existing ? 'reused' : labelPreviewError ? 'pending' : 'missing',
      existingColor: existing?.color || null,
      existingDescription: existing?.description || null,
      willOverwriteExistingMetadata: false,
      action: existing
        ? 'Reuse the existing label without silently changing its color or description.'
        : 'Ensure this managed lifecycle label exists after final confirmation.',
    };
  });

  let templatePreviewError = null;
  let template;
  try {
    const loaded = (options.templatePreviewLoader || loadTemplatePreview)(checkoutPath, options) || {};
    template = {
      ...loaded,
      path: loaded.path || INSTALLED_TEMPLATE_PATH,
      content: loaded.content || loadBundledTemplateContent(options),
    };
  } catch (error) {
    templatePreviewError = String(error?.message || error);
    template = {
      path: INSTALLED_TEMPLATE_PATH,
      status: 'bundled',
      setupPrChangeRequired: true,
      message: 'Bundled automation issue template preview.',
      content: loadBundledTemplateContent(options),
    };
  }

  return {
    labels,
    labelSummary: {
      missing: labels.filter((label) => label.status === 'missing').length,
      reused: labels.filter((label) => label.status === 'reused').length,
      pending: labels.filter((label) => label.status === 'pending').length,
    },
    template,
    directGitHubChanges: ['Ensure managed lifecycle labels exist after final confirmation.'],
    setupPullRequestChanges: template.setupPrChangeRequired ? [template.path] : [],
    previewErrors: {
      labels: labelPreviewError,
      template: templatePreviewError,
    },
  };
}

function validateSelection(selection, context) {
  const blockers = [];
  if (!context.repository) blockers.push({
    code: 'issues-repository-required',
    message: 'Choose and verify a GitHub repository before configuring issue automation.',
    recoveryAction: 'Return to GitHub repository setup and choose a repository.',
  });
  if (!ISSUE_SELECTION_MODES.includes(selection.mode)) blockers.push({
    code: 'issues-selection-mode-invalid',
    message: 'Choose Recommended labels or All open issues.',
    recoveryAction: 'Choose one supported issue-selection mode.',
  });
  if (!Number.isInteger(selection.maxActive) || selection.maxActive < 1 || selection.maxActive > 20) blockers.push({
    code: 'issues-max-active-invalid',
    message: 'Maximum simultaneous issues must be an integer from 1 through 20.',
    recoveryAction: 'Choose a value from 1 through 20.',
  });
  if (!Number.isInteger(selection.temporaryFailureRetries) || selection.temporaryFailureRetries < 0 || selection.temporaryFailureRetries > 20) blockers.push({
    code: 'issues-retries-invalid',
    message: 'Temporary retries must be an integer from 0 through 20.',
    recoveryAction: 'Choose a value from 0 through 20.',
  });
  for (const label of selection.excludedLabels) {
    if (label.length > 100 || /[\r\n]/.test(label)) blockers.push({
      code: 'issues-excluded-label-invalid',
      message: 'Excluded labels must be valid GitHub label names.',
      recoveryAction: 'Remove invalid excluded-label values.',
    });
  }
  return { ok: blockers.length === 0, blockers };
}

function pageContext(session, options = {}) {
  const repository = repositorySelection(session);
  const checkoutPath = checkoutSelection(session);
  let preview = null;
  let previewError = null;
  if (repository.repository) {
    try {
      preview = (options.previewLoader || buildIssueInstallationPreview)({
        repository: repository.repository,
        checkoutPath,
      }, options);
    } catch (error) {
      previewError = String(error?.message || error);
    }
  }
  return {
    repository: repository.repository,
    baseBranch: repository.baseBranch,
    checkoutPath,
    preview,
    previewError,
  };
}

function response(session, context) {
  const selection = selections(session);
  const validation = validateSelection(selection, context);
  return {
    selection,
    repository: context.repository,
    baseBranch: context.baseBranch,
    preview: context.preview,
    check: session.pages?.issues?.lastCheck || {
      ok: validation.ok,
      summary: validation.ok ? 'Issue settings are ready.' : validation.blockers[0]?.message || 'Issue setup needs attention.',
      blockers: validation.blockers,
    },
    lifecycleLabels: Object.values(LIFECYCLE_LABEL_CATALOG),
    readyLabel: PASEO_LABELS.ready,
    explanations: {
      ordering: 'Eligible issues are processed by lowest issue number first. A native GitHub blocked-by dependency temporarily skips only that issue so the next eligible issue can run.',
      dependencies: 'Native GitHub blocked-by relationships are execution dependencies. Parent/sub-issue hierarchy and issue-body references do not create execution dependencies.',
      template: 'This is the template that issues need to follow to be automatically processed.',
      customLabels: 'Existing labels with the same managed name are reused; setup does not silently overwrite user-customized colors or descriptions.',
    },
    technicalDetails: {
      repository: context.repository,
      baseBranch: context.baseBranch,
      checkoutPath: context.checkoutPath,
      previewError: context.previewError,
      labelPreviewError: context.preview?.previewErrors?.labels || null,
      templatePreviewError: context.preview?.previewErrors?.template || null,
      templatePath: INSTALLED_TEMPLATE_PATH,
    },
  };
}

export function getIssuesSetupPageStatus(options = {}) {
  const session = activeSession(options);
  return response(session, pageContext(session, options));
}

export function saveIssuesSetupPage(input = {}, options = {}) {
  const priorSession = activeSession(options);
  const prior = selections(priorSession);
  const next = {
    mode: String(input.mode ?? prior.mode).trim(),
    maxActive: Number(input.maxActive ?? prior.maxActive),
    temporaryFailureRetries: Number(input.temporaryFailureRetries ?? prior.temporaryFailureRetries),
    excludedLabels: Array.isArray(input.excludedLabels)
      ? [...new Set(input.excludedLabels.map((label) => String(label || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      : prior.excludedLabels,
  };
  let session = saveSetupPage('issues', { selections: next }, options);
  const context = pageContext(session, options);
  const validation = validateSelection(selections(session), context);
  session = recordSetupPageCheck('issues', {
    ok: validation.ok,
    summary: validation.ok ? 'Issue settings are ready.' : validation.blockers[0]?.message || 'Issue setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(session, context);
}

export function recheckIssuesSetupPage(options = {}) {
  let session = activeSession(options);
  const context = pageContext(session, options);
  const validation = validateSelection(selections(session), context);
  session = recordSetupPageCheck('issues', {
    ok: validation.ok,
    summary: validation.ok ? 'Issue settings are ready.' : validation.blockers[0]?.message || 'Issue setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(session, context);
}
