import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_MODES, loadControllerMode, saveControllerMode } from './controller-mode.mjs';
import { loadExternalMaintenance } from './external-maintenance.mjs';
import {
  AUTOMATION_PACKAGE_NAME,
  dependencyLocation,
  loadExternalMigration,
  saveExternalMigration,
} from './external-migration.mjs';
import { activeAutomationIssues, PASEO_SERVICE, PASEO_SERVICE_NAME } from './install-legacy.mjs';
import { run } from './process.mjs';
import {
  loadSetupPullRequest,
  reconcileSetupPullRequest,
  setupChangeStatus,
} from './setup-pr.mjs';
import {
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveIntegration,
  saveRuntime,
} from './state.mjs';

const TEXT_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function lockfileReferences(root) {
  return TEXT_LOCKFILES.filter((file) => {
    const target = path.join(root, file);
    return existsSync(target) && readFileSync(target, 'utf8').includes(AUTOMATION_PACKAGE_NAME);
  });
}

function embeddedServiceInspection(root, integration = loadIntegration(root)) {
  const relative = integration.paseoJson?.path || 'paseo.json';
  const file = path.join(root, relative);
  if (!existsSync(file)) return { path: relative, state: 'absent', service: null };
  const value = readJson(file);
  const service = value?.scripts?.[PASEO_SERVICE_NAME] || null;
  if (!service) return { path: relative, state: 'absent', service: null };
  return {
    path: relative,
    state: sameJson(service, PASEO_SERVICE) ? 'managed-present' : 'changed-present',
    service,
  };
}

function pendingLifecycleReason(root) {
  const migration = loadExternalMigration(root);
  if (migration?.state === 'open' || (migration?.state === 'merged' && !migration.syncedAt)) {
    return `Migration PR #${migration.number} is already awaiting completion.`;
  }
  const removal = loadExternalMaintenance(root)?.removal;
  if (removal?.state === 'open' || (removal?.state === 'merged' && !removal.syncedAt)) {
    return `Removal PR #${removal.number} is already awaiting completion.`;
  }
  return null;
}

export function inspectExternalMigrationAdoption(root, { runner = run } = {}) {
  const mode = loadControllerMode(root);
  const config = loadConfig(root);
  const integration = loadIntegration(root);
  const reasons = [];
  const packageFile = path.join(root, 'package.json');
  let dependency = null;

  if (mode !== CONTROLLER_MODES.embedded) {
    reasons.push('The repository is not recorded as an embedded controller installation.');
  }
  if (!existsSync(packageFile)) {
    reasons.push('package.json is required to verify that the embedded dependency is gone.');
  } else {
    dependency = dependencyLocation(readJson(packageFile));
    if (dependency) reasons.push(`${AUTOMATION_PACKAGE_NAME} is still declared in package.json.`);
  }

  const lockfiles = lockfileReferences(root);
  if (lockfiles.length) {
    reasons.push(`${AUTOMATION_PACKAGE_NAME} is still referenced by: ${lockfiles.join(', ')}.`);
  }

  const service = embeddedServiceInspection(root, integration);
  if (service.state === 'managed-present') {
    reasons.push(`The package-managed ${PASEO_SERVICE_NAME} service is still present in ${service.path}.`);
  } else if (service.state === 'changed-present') {
    reasons.push(`The ${PASEO_SERVICE_NAME} service in ${service.path} differs from the package-managed service and must be reviewed manually.`);
  }

  const lifecycleReason = pendingLifecycleReason(root);
  if (lifecycleReason) reasons.push(lifecycleReason);

  const changes = setupChangeStatus(root, { runner, mode: CONTROLLER_MODES.external });
  if (!changes.available) {
    reasons.push(changes.reason || 'Git status is unavailable.');
  } else {
    if (!config.baseBranch) reasons.push('Select the repository base branch before finalizing migration.');
    else if (changes.currentBranch !== config.baseBranch) {
      reasons.push(`Switch to the configured base branch ${config.baseBranch} before finalizing migration.`);
    }
    if (changes.changedFiles.length) {
      reasons.push(`Finalizing migration requires a clean working tree; changed files: ${changes.changedFiles.join(', ')}.`);
    }
  }

  const activeIssues = activeAutomationIssues(root);
  if (activeIssues.length) {
    reasons.push(`Stop active automation issues before finalizing migration: ${activeIssues.map((item) => `#${item.issueNumber}`).join(', ')}.`);
  }

  return {
    ready: reasons.length === 0,
    reasons,
    dependency,
    lockfiles,
    service,
    currentBranch: changes.currentBranch,
    baseBranch: config.baseBranch || null,
    changedFiles: changes.changedFiles || [],
    staleServiceOwnership: integration.paseoJson?.serviceAddedByPackage === true,
    setupPullRequest: loadSetupPullRequest(root),
  };
}

export function adoptAlreadyMigratedRepository(root, {
  runner = run,
  setupReconciler = reconcileSetupPullRequest,
  now = new Date(),
} = {}) {
  setupReconciler(root, { runner });
  const inspection = inspectExternalMigrationAdoption(root, { runner });
  if (!inspection.ready) {
    throw new Error(`Existing migration cannot be finalized: ${inspection.reasons.join(' ')}`);
  }

  const integration = loadIntegration(root);
  saveIntegration(root, { ...integration, paseoJson: null });
  saveControllerMode(root, CONTROLLER_MODES.external);

  const completedAt = now.toISOString();
  const existing = loadExternalMigration(root) || {};
  const migration = saveExternalMigration(root, {
    ...existing,
    state: 'completed',
    source: 'existing-repository-state',
    targetMode: CONTROLLER_MODES.external,
    adoptedAt: completedAt,
    syncedAt: completedAt,
    completedAt,
    syncError: null,
    files: existing.files || ['package.json', ...inspection.lockfiles, inspection.service.path],
  });

  saveConfig(root, { ...loadConfig(root), setupComplete: false });
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });

  return {
    adopted: true,
    controllerMode: CONTROLLER_MODES.external,
    migration,
    inspection,
  };
}
