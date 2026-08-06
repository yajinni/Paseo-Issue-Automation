import {
  deriveRepositoryBlockers,
  repositoryOperationalSummary,
} from './repository-blockers.mjs';

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
  return [...maintenanceBlockers(status), ...deriveRepositoryBlockers(status)];
}

export function managedRepositoryOperationalSummary(status = {}) {
  const blockers = deriveManagedRepositoryBlockers(status);
  return {
    blockers,
    operational: repositoryOperationalSummary(status, blockers),
  };
}
