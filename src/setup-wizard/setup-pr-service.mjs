import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLLER_MODES, saveControllerMode } from '../controller-mode.mjs';
import { LIFECYCLE_LABEL_CATALOG } from '../label-catalog.mjs';
import { run as defaultRun, runJson as defaultRunJson } from '../process.mjs';
import {
  SETUP_PULL_REQUEST_BRANCH,
  createSetupPullRequest,
  loadSetupPullRequest,
  reconcileSetupPullRequest,
  saveSetupPullRequest,
} from '../setup-pr.mjs';
import {
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  saveRuntime,
} from '../state.mjs';
import { buildIssueInstallationPreview } from './issues-page-service.mjs';
import { loadSetupSessionStore } from './store.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/automated-coding-task.md';
const SOURCE_TEMPLATE = path.join(PACKAGE_ROOT, 'templates', 'automated-coding-task.md');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function activeSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function repositoryContext(session) {
  const repositoryPage = session.pages?.repository?.selections || {};
  const checkoutPage = session.pages?.checkout?.selections || {};
  return {
    repository: String(repositoryPage.repository || session.repository?.nameWithOwner || '').trim(),
    baseBranch: String(repositoryPage.baseBranch || session.baseBranch || '').trim(),
    checkoutPath: String(
      repositoryPage.checkoutPath
      || checkoutPage.checkoutPath
      || session.managedCheckout?.path
      || session.managedCheckoutChoice
      || '',
    ).trim(),
  };
}

function normalizeFiles(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replaceAll('\\', '/').replace(/^\.\//, '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sameFiles(left, right) {
  return JSON.stringify(normalizeFiles(left)) === JSON.stringify(normalizeFiles(right));
}

function branchAvailable(root, runner = defaultRun) {
  const local = runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${SETUP_PULL_REQUEST_BRANCH}`], {
    cwd: root,
    allowFailure: true,
  });
  if (local.ok) return false;
  const remote = runner('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${SETUP_PULL_REQUEST_BRANCH}`], {
    cwd: root,
    allowFailure: true,
  });
  return !remote.ok;
}

function confirmationSnapshot(session, options = {}) {
  const context = repositoryContext(session);
  if (!context.repository) throw new Error('Choose a GitHub repository before confirming installation.');
  if (!context.baseBranch) throw new Error('Choose the base branch before confirming installation.');
  if (!context.checkoutPath) throw new Error('Prepare the managed checkout before confirming installation.');
  const preview = (options.previewBuilder || buildIssueInstallationPreview)({
    repository: context.repository,
    checkoutPath: context.checkoutPath,
  }, options);
  return {
    repository: context.repository,
    selectedBaseBranch: context.baseBranch,
    issuePullRequestBaseBranch: context.baseBranch,
    setupBranch: SETUP_PULL_REQUEST_BRANCH,
    files: normalizeFiles(preview.setupPullRequestChanges),
    labels: preview.labels.map((label) => ({
      name: label.name,
      action: label.status === 'missing' ? 'create' : 'reuse',
      existingColor: label.existingColor,
      existingDescription: label.existingDescription,
    })),
    autoMerge: true,
    requiresSameBaseBranchConfirmation: true,
  };
}

export function getSetupPullRequestConfirmation(options = {}) {
  const session = activeSession(options);
  return confirmationSnapshot(session, options);
}

export function validateSetupPullRequestConfirmation(input = {}, options = {}) {
  const expected = getSetupPullRequestConfirmation(options);
  const submitted = {
    repository: String(input.repository || '').trim(),
    selectedBaseBranch: String(input.selectedBaseBranch || '').trim(),
    issuePullRequestBaseBranch: String(input.issuePullRequestBaseBranch || '').trim(),
    setupBranch: String(input.setupBranch || '').trim(),
    files: normalizeFiles(input.files),
    autoMerge: input.autoMerge !== false,
    confirmSameBaseBranch: input.confirmSameBaseBranch === true,
  };
  if (submitted.repository !== expected.repository) throw new Error('The repository changed after the setup confirmation was prepared. Recheck before continuing.');
  if (submitted.selectedBaseBranch !== expected.selectedBaseBranch) throw new Error('The selected base branch changed after the setup confirmation was prepared. Recheck before continuing.');
  if (submitted.issuePullRequestBaseBranch !== expected.issuePullRequestBaseBranch) throw new Error('The setup PR must target the same base branch that future issue PRs will target.');
  if (submitted.setupBranch !== expected.setupBranch) throw new Error('The setup branch changed after confirmation was prepared. Recheck before continuing.');
  if (!sameFiles(submitted.files, expected.files)) throw new Error('The setup PR file list changed after confirmation was prepared. Recheck before continuing.');
  if (!submitted.confirmSameBaseBranch) throw new Error('Confirm that the setup PR and future issue PRs target the same base branch.');
  return { ...expected, autoMerge: submitted.autoMerge, confirmed: true };
}

function listRepositoryLabels(repository, options = {}) {
  const jsonRunner = options.jsonRunner || defaultRunJson;
  const labels = jsonRunner('gh', [
    'label', 'list', '--repo', repository, '--limit', '1000', '--json', 'name,color,description',
  ], { cwd: options.checkoutPath, allowFailure: false });
  if (!Array.isArray(labels)) throw new Error('GitHub did not return the repository label catalog.');
  return labels;
}

export function installConfirmedLifecycleLabels(repository, checkoutPath, options = {}) {
  const runner = options.runner || defaultRun;
  const existing = new Map(listRepositoryLabels(repository, { ...options, checkoutPath }).map((label) => [label.name, label]));
  const integration = loadIntegration(checkoutPath);
  const ownership = { ...(integration.labels || {}) };
  const results = [];
  for (const managed of Object.values(LIFECYCLE_LABEL_CATALOG)) {
    const current = existing.get(managed.name);
    if (current) {
      ownership[managed.name] = ownership[managed.name] || { createdByPackage: false };
      results.push({ name: managed.name, action: 'reused', color: current.color, description: current.description });
      continue;
    }
    runner('gh', [
      'label', 'create', managed.name,
      '--repo', repository,
      '--color', managed.color,
      '--description', managed.description,
    ], { cwd: checkoutPath });
    ownership[managed.name] = { createdByPackage: true };
    results.push({ name: managed.name, action: 'created', color: managed.color, description: managed.description });
  }
  saveIntegration(checkoutPath, { ...integration, labels: ownership });
  return results;
}

export function installConfirmedIssueTemplate(root, options = {}) {
  const source = options.sourceTemplate || SOURCE_TEMPLATE;
  const readFile = options.readFileSync || readFileSync;
  const writeFile = options.writeFileSync || writeFileSync;
  const makeDir = options.mkdirSync || mkdirSync;
  const fileExists = options.existsSync || existsSync;
  const target = path.join(root, TEMPLATE_PATH);
  const expected = readFile(source, 'utf8');
  const existed = fileExists(target);
  makeDir(path.dirname(target), { recursive: true });
  writeFile(target, expected, 'utf8');
  const integration = loadIntegration(root);
  saveIntegration(root, {
    ...integration,
    issueTemplate: {
      path: TEMPLATE_PATH,
      createdByPackage: integration.issueTemplate?.createdByPackage === true || !existed,
      contentManagedByPackage: true,
      expectedSha256: sha256(expected),
    },
  });
  return { path: TEMPLATE_PATH, created: !existed, updated: existed, expectedSha256: sha256(expected) };
}

export function requestSetupPullRequestAutoMerge(root, pullRequest, options = {}) {
  if (!pullRequest?.number) return { requested: false, enabled: false, reason: 'No setup pull request was created.' };
  const runner = options.runner || defaultRun;
  const result = runner('gh', [
    'pr', 'merge', String(pullRequest.number), '--auto', '--merge',
  ], { cwd: root, allowFailure: true });
  if (result.ok) return { requested: true, enabled: true, reason: null, action: null };
  return {
    requested: true,
    enabled: false,
    reason: result.stderr || result.stdout || 'GitHub auto-merge could not be enabled for the setup PR.',
    action: 'Review the setup PR in GitHub and enable or complete the merge without bypassing checks, reviews, protections, or rulesets.',
  };
}

function setupPreview(context, options = {}) {
  return (options.previewBuilder || buildIssueInstallationPreview)({
    repository: context.repository,
    checkoutPath: context.checkoutPath,
  }, options);
}

function setupPrLabelCountNeedsRepair(preview) {
  const summary = preview?.labelSummary || {};
  return Number(summary.missing || 0) > 0
    || Number(summary.pending || 0) > 0
    || Boolean(preview?.previewErrors?.labels);
}

function repairSummary(action, pullRequest, autoMerge = null) {
  const number = pullRequest?.number ? ` #${pullRequest.number}` : '';
  if (action === 'waiting-pr') {
    return `Setup issues detected. Setup PR${number} is open to fix them. Paseo will continue after it is merged.`;
  }
  if (action === 'waiting-sync') {
    return `Setup PR${number} merged with the required fixes. Paseo is waiting to synchronize the selected base branch.`;
  }
  if (action === 'created-pr') {
    const mergeCopy = autoMerge?.enabled
      ? ' Auto-merge was requested through normal repository policy.'
      : ' Merge the PR after the repository\'s required checks and reviews allow it.';
    return `Setup issues detected. Paseo created setup PR${number} to fix them.${mergeCopy}`;
  }
  return 'Repository setup files and lifecycle labels are current.';
}

export function repairSetupRepository(options = {}) {
  const session = activeSession(options);
  const context = repositoryContext(session);
  if (!context.repository) throw new Error('Choose a GitHub repository before repairing setup.');
  if (!context.baseBranch) throw new Error('Choose the base branch before repairing setup.');
  if (!context.checkoutPath) throw new Error('Prepare the Paseo project checkout before repairing setup.');

  const runner = options.runner || defaultRun;
  const jsonRunner = options.jsonRunner || defaultRunJson;
  let pullRequest = null;
  let reconciliationError = null;
  try {
    pullRequest = (options.reconciler || reconcileSetupPullRequest)(context.checkoutPath, {
      ...options,
      runner,
      jsonRunner,
    });
  } catch (error) {
    reconciliationError = String(error?.message || error);
  }

  const preview = setupPreview(context, options);
  const files = normalizeFiles(preview?.setupPullRequestChanges);
  const templateError = preview?.previewErrors?.template || null;
  if (templateError) {
    throw new Error(`Repository setup files could not be verified: ${templateError}`);
  }

  let labels = [];
  if (setupPrLabelCountNeedsRepair(preview)) {
    labels = (options.labelInstaller || installConfirmedLifecycleLabels)(
      context.repository,
      context.checkoutPath,
      { ...options, runner, jsonRunner },
    );
  }
  const createdLabels = labels.filter((item) => item.action === 'created');

  if (!files.length) {
    return {
      ready: true,
      issuesDetected: false,
      action: createdLabels.length ? 'repaired-directly' : 'none',
      summary: createdLabels.length
        ? `Repository setup repaired. Created ${createdLabels.length} missing lifecycle label${createdLabels.length === 1 ? '' : 's'}; managed setup files are current.`
        : repairSummary('none'),
      files: [],
      labels,
      pullRequest,
      reconciliationError,
    };
  }

  if (reconciliationError) {
    throw new Error(`Setup issues were detected, but Paseo could not check the previous setup pull request: ${reconciliationError}`);
  }

  if (pullRequest?.state === 'open') {
    return {
      ready: false,
      issuesDetected: true,
      action: 'waiting-pr',
      summary: repairSummary('waiting-pr', pullRequest),
      files,
      labels,
      pullRequest,
      reconciliationError: null,
    };
  }

  if (pullRequest?.state === 'merged' && !pullRequest.syncedAt) {
    return {
      ready: false,
      issuesDetected: true,
      action: 'waiting-sync',
      summary: repairSummary('waiting-sync', pullRequest),
      files,
      labels,
      pullRequest,
      reconciliationError: null,
    };
  }

  const config = loadConfig(context.checkoutPath);
  if (config.baseBranch !== context.baseBranch) {
    throw new Error(`The selected base branch ${context.baseBranch} does not match the managed checkout base branch ${config.baseBranch || 'not configured'}. Recheck repository setup before repairing files.`);
  }

  const unsupported = files.filter((file) => file !== TEMPLATE_PATH);
  if (unsupported.length) {
    throw new Error(`Paseo detected managed setup files without an automatic repair handler: ${unsupported.join(', ')}.`);
  }

  saveRuntime(context.checkoutPath, { ...loadRuntime(context.checkoutPath), claimsEnabled: false });
  saveConfig(context.checkoutPath, { ...config, setupComplete: false });
  saveControllerMode(context.checkoutPath, CONTROLLER_MODES.external);

  let template = null;
  if (files.includes(TEMPLATE_PATH)) {
    template = (options.templateInstaller || installConfirmedIssueTemplate)(context.checkoutPath, options);
  }

  const submission = (options.pullRequestCreator || createSetupPullRequest)(context.checkoutPath, {
    runner,
    jsonRunner,
    mode: CONTROLLER_MODES.external,
    now: options.now,
  });

  if (!submission.created) {
    const after = setupPreview(context, options);
    const remaining = normalizeFiles(after?.setupPullRequestChanges);
    if (!remaining.length) {
      return {
        ready: true,
        issuesDetected: false,
        action: 'repaired-directly',
        summary: repairSummary('none'),
        files: [],
        labels,
        template,
        pullRequest: null,
        reconciliationError: null,
      };
    }
    throw new Error(submission.reason || `Paseo detected setup changes but could not create the setup pull request for: ${remaining.join(', ')}.`);
  }

  const autoMerge = (options.autoMergeRequester || requestSetupPullRequestAutoMerge)(
    context.checkoutPath,
    submission.pullRequest,
    { ...options, runner },
  );
  const saved = saveSetupPullRequest(context.checkoutPath, {
    ...loadSetupPullRequest(context.checkoutPath),
    repair: {
      repository: context.repository,
      baseBranch: context.baseBranch,
      files,
      automatic: true,
      createdAt: new Date().toISOString(),
    },
    autoMerge,
  });

  return {
    ready: false,
    issuesDetected: true,
    action: 'created-pr',
    summary: repairSummary('created-pr', saved, autoMerge),
    files,
    labels,
    template,
    pullRequest: saved,
    autoMerge,
    reconciliationError: null,
  };
}

export function confirmAndCreateSetupPullRequest(input = {}, options = {}) {
  const confirmation = validateSetupPullRequestConfirmation(input, options);
  const session = activeSession(options);
  const context = repositoryContext(session);
  const runner = options.runner || defaultRun;
  const jsonRunner = options.jsonRunner || defaultRunJson;
  if (!branchAvailable(context.checkoutPath, runner)) {
    throw new Error(`The reserved setup branch ${SETUP_PULL_REQUEST_BRANCH} already exists. Reconcile or remove the prior setup branch before confirming a new setup PR.`);
  }
  const config = loadConfig(context.checkoutPath);
  if (config.baseBranch !== confirmation.selectedBaseBranch) {
    throw new Error('The managed checkout base branch does not match the confirmed setup target. Recheck before continuing.');
  }

  saveRuntime(context.checkoutPath, { ...loadRuntime(context.checkoutPath), claimsEnabled: false });
  saveConfig(context.checkoutPath, { ...config, setupComplete: false });
  saveControllerMode(context.checkoutPath, CONTROLLER_MODES.external);

  const labels = (options.labelInstaller || installConfirmedLifecycleLabels)(
    confirmation.repository,
    context.checkoutPath,
    { ...options, runner, jsonRunner },
  );
  let template = null;
  if (confirmation.files.includes(TEMPLATE_PATH)) {
    template = (options.templateInstaller || installConfirmedIssueTemplate)(context.checkoutPath, options);
  }
  const submission = (options.pullRequestCreator || createSetupPullRequest)(context.checkoutPath, {
    runner,
    jsonRunner,
    mode: CONTROLLER_MODES.external,
    now: options.now,
  });
  if (!submission.created) {
    return { confirmation, labels, template, ...submission, autoMerge: { requested: false, enabled: false, reason: submission.reason } };
  }
  const pr = submission.pullRequest;
  if (pr.baseBranch !== confirmation.selectedBaseBranch || pr.branch !== confirmation.setupBranch || !sameFiles(pr.files, confirmation.files)) {
    throw new Error('The created setup PR does not match the confirmed repository target, branch, or file list. Claims remain paused.');
  }
  const autoMerge = confirmation.autoMerge
    ? (options.autoMergeRequester || requestSetupPullRequestAutoMerge)(context.checkoutPath, pr, { ...options, runner })
    : { requested: false, enabled: false, reason: 'Automatic merge was disabled by confirmation.', action: 'Merge the setup PR manually after required checks and reviews pass.' };
  const saved = saveSetupPullRequest(context.checkoutPath, {
    ...loadSetupPullRequest(context.checkoutPath),
    confirmation: {
      repository: confirmation.repository,
      selectedBaseBranch: confirmation.selectedBaseBranch,
      issuePullRequestBaseBranch: confirmation.issuePullRequestBaseBranch,
      setupBranch: confirmation.setupBranch,
      files: confirmation.files,
      autoMerge: confirmation.autoMerge,
    },
    autoMerge,
  });
  return { confirmation, labels, template, ...submission, pullRequest: saved, autoMerge };
}

function verifyInstalledTemplate(root, options = {}) {
  const readFile = options.readFileSync || readFileSync;
  const fileExists = options.existsSync || existsSync;
  const source = options.sourceTemplate || SOURCE_TEMPLATE;
  const target = path.join(root, TEMPLATE_PATH);
  if (!fileExists(target)) return { ok: false, reason: `${TEMPLATE_PATH} is missing after setup PR synchronization.` };
  const expected = readFile(source, 'utf8');
  const current = readFile(target, 'utf8');
  if (current !== expected) return { ok: false, reason: `${TEMPLATE_PATH} does not match the confirmed package template after synchronization.` };
  return { ok: true, reason: null };
}

export function reconcileConfirmedSetupPullRequest(root, options = {}) {
  const pullRequest = (options.reconciler || reconcileSetupPullRequest)(root, options);
  if (!pullRequest?.number || pullRequest.state !== 'merged' || !pullRequest.syncedAt) return pullRequest;
  const verification = (options.verifier || verifyInstalledTemplate)(root, options);
  const next = saveSetupPullRequest(root, {
    ...pullRequest,
    installationVerifiedAt: verification.ok ? new Date().toISOString() : null,
    installationVerificationError: verification.reason,
  });
  if (!verification.ok) {
    saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
    saveConfig(root, { ...loadConfig(root), setupComplete: false });
  }
  return next;
}

export function confirmedSetupPullRequestReady(value) {
  if (!value) return true;
  return value.state === 'merged' && Boolean(value.syncedAt) && Boolean(value.installationVerifiedAt);
}
