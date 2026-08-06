import { managerHtml as reviewManagerHtml } from './manager-review-ui.mjs';

const INSTALL_PANEL = `  <section class="card wide" style="margin-top:14px">
    <h2>Repository integration</h2>
    <dl class="facts" id="controller-mode-facts"><dt>Controller mode</dt><dd>Loading…</dd></dl>
    <div class="actions" style="margin-top:12px">
      <button id="install-external-controller" disabled>Install for standalone manager</button>
      <button id="migrate-embedded-controller" class="warning" disabled>Create migration PR</button>
      <button id="reconcile-controller-migration" class="secondary" disabled>Reconcile migration PR</button>
    </div>
    <p class="muted">External installation adds the issue template, GitHub labels, Paseo workspace, and repository-local state. It does not add Paseo Issue Automation to <code>package.json</code>, any lockfile, <code>node_modules</code>, or <code>paseo.json</code>.</p>
    <p class="muted">Embedded migration creates a reviewed PR that removes the project dependency, updates its lockfile, and removes only the package-managed service launcher. Controller mode changes only after that PR merges and the local base branch synchronizes.</p>
    <div id="setup-pr-link" class="muted"></div>
    <div id="migration-pr-link" class="muted"></div>
  </section>
`;

const INSTALL_SCRIPT = `<script>
function appendPrLink(target, prefix, pullRequest) {
  target.textContent = '';
  if (!pullRequest || !pullRequest.url) return false;
  const anchor = document.createElement('a');
  anchor.href = pullRequest.url;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  anchor.textContent = prefix + ' #' + pullRequest.number + ': ' + pullRequest.state;
  target.append(anchor);
  return true;
}

function renderExternalInstallation(data) {
  const setup = data.setup || {};
  const capabilities = data.capabilities || {};
  const migration = setup.migration || null;
  const mode = setup.controllerMode === 'external-manager'
    ? 'External standalone manager'
    : setup.controllerMode === 'embedded-repository'
      ? 'Embedded repository dependency'
      : 'Not installed';
  facts('controller-mode-facts', [
    ['Controller mode', mode],
    ['Setup complete', setup.complete ? 'Yes' : 'No'],
    ['Migration state', migration ? migration.state : 'Not started'],
    ['Migration sync error', migration && migration.syncError],
    ['Managed setup files', (setup.repositoryChanges && setup.repositoryChanges.managedFiles || []).join(', ') || 'None'],
    ['Pending managed files', (setup.repositoryChanges && setup.repositoryChanges.expectedFiles || []).join(', ') || 'None'],
    ['Unrelated working-tree changes', (setup.repositoryChanges && setup.repositoryChanges.unexpectedFiles || []).join(', ') || 'None'],
    ['Package dependency', setup.externalController ? 'Not used' : setup.embeddedController ? 'Embedded mode' : 'Not installed'],
  ]);
  const workerRunning = Boolean(data.worker && data.worker.running);
  const reviewWorkerRunning = Boolean(data.reviewWorker && data.reviewWorker.running);
  const workersRunning = workerRunning || reviewWorkerRunning;

  const installButton = document.getElementById('install-external-controller');
  installButton.disabled = !capabilities.externalInstallation || workersRunning;
  installButton.textContent = setup.externalController
    ? 'External integration installed'
    : capabilities.migrationRequired
      ? 'Use migration for embedded installation'
      : workersRunning
        ? 'Stop repository workers before installation'
        : 'Install for standalone manager';

  const migrationButton = document.getElementById('migrate-embedded-controller');
  migrationButton.disabled = !capabilities.embeddedMigration || workersRunning;
  migrationButton.textContent = setup.migrationPending
    ? 'Migration PR is pending'
    : workersRunning
      ? 'Stop repository workers before migration'
      : 'Create migration PR';

  const reconcileButton = document.getElementById('reconcile-controller-migration');
  reconcileButton.disabled = !capabilities.migrationReconciliation || workersRunning;

  const setupLink = document.getElementById('setup-pr-link');
  if (!appendPrLink(setupLink, 'Setup PR', setup.pullRequest) && setup.externalController) {
    setupLink.textContent = 'No setup PR is currently recorded.';
  }
  const migrationLink = document.getElementById('migration-pr-link');
  if (!appendPrLink(migrationLink, 'Migration PR', migration)) {
    migrationLink.textContent = setup.embeddedController ? 'No migration PR is currently recorded.' : '';
  }
}

document.getElementById('install-external-controller').addEventListener('click', async () => {
  if (!currentStatus || !confirm('Install the selected repository for the standalone manager? This creates or reuses the issue template, labels, and workspace without adding a package dependency or lockfile entry.')) return;
  try {
    await postRepositoryAction('install/external');
  } catch (error) { showError(error); }
});

document.getElementById('migrate-embedded-controller').addEventListener('click', async () => {
  if (!currentStatus || !confirm('Create a migration PR that removes the repository-embedded Paseo dependency and managed service launcher? Automation will remain paused until the PR merges and synchronization completes.')) return;
  try {
    await postRepositoryAction('migrate/external');
  } catch (error) { showError(error); }
});

document.getElementById('reconcile-controller-migration').addEventListener('click', async () => {
  try {
    await postRepositoryAction('migrate/reconcile');
  } catch (error) { showError(error); }
});
</script>`;

export function managerHtml() {
  return reviewManagerHtml()
    .replace(
      `  <form class="register" id="register-form">`,
      `${INSTALL_PANEL}  <form class="register" id="register-form">`,
    )
    .replace(
      `  currentStatus = data;`,
      `  currentStatus = data;\n  renderExternalInstallation(data);`,
    )
    .replace(
      'Manager-wide fair coding capacity is enforced. PR-review schedulers are repository-scoped and share the existing machine-global serial browser lease. Installation remains separate.',
      'Manager-wide fair coding capacity and repository-scoped PR-review schedulers are available. Repository integration can use the external manager without a project package dependency.',
    )
    .replace(
      'Manager-wide fair coding capacity and repository PR-review schedulers are available. Installation remains separate.',
      'Manager-wide fair coding capacity, repository PR-review schedulers, external installation, and reviewed embedded migration are available.',
    )
    .replace('</body>', `${INSTALL_SCRIPT}\n</body>`);
}
