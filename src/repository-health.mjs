import {
  deriveRepositoryBlockers,
  repositoryOperationalSummary,
} from './repository-blockers.mjs';

function adoptionBlockers(status) {
  const adoption = status?.setup?.migrationAdoption;
  if (!status?.setup?.embeddedController || adoption?.ready !== true) return [];
  const name = status?.repository?.repository || status?.repository?.name || 'this repository';
  return [{
    code: 'external-migration-adoption-ready',
    severity: 'error',
    scope: 'migration',
    title: 'Repository files are already migrated',
    message: `${name} no longer contains the embedded package dependency or service, but machine-local controller state still says embedded. Finalize the existing migration instead of creating another migration PR.`,
    blocksIssueProcessing: true,
    action: {
      kind: 'button',
      label: 'Finalize existing migration',
      targetId: 'finalize-existing-migration',
    },
    details: adoption.setupPullRequest?.number
      ? { setupPullRequest: adoption.setupPullRequest.number }
      : null,
  }];
}

function maintenanceBlockers(status) {
  const name = status?.repository?.repository || status?.repository?.name || 'this repository';
  const removal = status?.maintenance?.removal;
  if (!removal?.number) return [];
  if (removal.state === 'open') {
    return [{
      code: 'external-removal-open',
      severity: 'error',
      scope: 'maintenance',
      title: `Removal PR #${removal.number} is awaiting merge`,
      message: `Issue processing for ${name} is paused until removal PR #${removal.number} merges and the local base branch synchronizes.`,
      blocksIssueProcessing: true,
      action: removal.url ? { kind: 'link', label: `Open removal PR #${removal.number}`, url: removal.url } : null,
      details: Array.isArray(removal.files) ? { files: removal.files } : null,
    }];
  }
  if (removal.state === 'merged' && !removal.syncedAt) {
    return [{
      code: 'external-removal-sync-pending',
      severity: 'error',
      scope: 'maintenance',
      title: `Removal PR #${removal.number} merged; cleanup is pending`,
      message: removal.syncError
        ? `Removal PR #${removal.number} merged, but ${name} could not finish synchronization and managed-resource cleanup: ${removal.syncError}`
        : `Removal PR #${removal.number} merged, but ${name} still needs local synchronization and managed-resource cleanup.`,
      blocksIssueProcessing: true,
      action: { kind: 'post', label: 'Retry removal synchronization', endpoint: 'maintenance/reconcile' },
      details: removal.syncError ? { syncError: removal.syncError } : null,
    }];
  }
  if (removal.state === 'closed' && !removal.syncedAt) {
    return [{
      code: 'external-removal-closed',
      severity: 'warning',
      scope: 'maintenance',
      title: `Removal PR #${removal.number} closed without completing removal`,
      message: `${name} remains installed for the standalone manager. Create a new removal PR only after reviewing why the prior PR closed.`,
      blocksIssueProcessing: status?.automation?.claimsEnabled !== true,
      action: { kind: 'button', label: 'Create a new removal PR', targetId: 'remove-external-controller' },
    }];
  }
  return [];
}

export function deriveManagedRepositoryBlockers(status = {}) {
  const adoption = adoptionBlockers(status);
  const repository = deriveRepositoryBlockers(status).filter((item) =>
    !(adoption.length && item.code === 'setup-incomplete'),
  );
  return [...maintenanceBlockers(status), ...adoption, ...repository];
}

export function managedRepositoryOperationalSummary(status = {}) {
  const blockers = deriveManagedRepositoryBlockers(status);
  return {
    blockers,
    operational: repositoryOperationalSummary(status, blockers),
  };
}
