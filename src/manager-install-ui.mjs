import { managerHtml as reviewManagerHtml } from './manager-review-ui.mjs';

const INSTALL_PANEL = `  <section class="card wide" style="margin-top:14px">
    <h2>Repository integration</h2>
    <dl class="facts" id="controller-mode-facts"><dt>Controller mode</dt><dd>Loading…</dd></dl>
    <div class="actions" style="margin-top:12px">
      <button id="install-external-controller" disabled>Install for standalone manager</button>
    </div>
    <p class="muted">External installation adds the issue template, GitHub labels, Paseo workspace, and repository-local state. It does not add Paseo Issue Automation to <code>package.json</code>, any lockfile, <code>node_modules</code>, or <code>paseo.json</code>.</p>
    <div id="setup-pr-link" class="muted"></div>
  </section>
`;

const INSTALL_SCRIPT = `<script>
function renderExternalInstallation(data) {
  const setup = data.setup || {};
  const capabilities = data.capabilities || {};
  const mode = setup.controllerMode === 'external-manager'
    ? 'External standalone manager'
    : setup.controllerMode === 'embedded-repository'
      ? 'Embedded repository dependency'
      : 'Not installed';
  facts('controller-mode-facts', [
    ['Controller mode', mode],
    ['Setup complete', setup.complete ? 'Yes' : 'No'],
    ['Managed setup files', (setup.repositoryChanges && setup.repositoryChanges.managedFiles || []).join(', ') || 'None'],
    ['Pending managed files', (setup.repositoryChanges && setup.repositoryChanges.expectedFiles || []).join(', ') || 'None'],
    ['Unrelated working-tree changes', (setup.repositoryChanges && setup.repositoryChanges.unexpectedFiles || []).join(', ') || 'None'],
    ['Package dependency', setup.externalController ? 'Not used' : setup.embeddedController ? 'Embedded mode' : 'Not installed'],
  ]);
  const button = document.getElementById('install-external-controller');
  const workerRunning = Boolean(data.worker && data.worker.running);
  const reviewWorkerRunning = Boolean(data.reviewWorker && data.reviewWorker.running);
  button.disabled = !capabilities.externalInstallation || workerRunning || reviewWorkerRunning;
  button.textContent = setup.externalController
    ? 'External integration installed'
    : capabilities.migrationRequired
      ? 'Migration required for embedded installation'
      : workerRunning || reviewWorkerRunning
        ? 'Stop repository workers before installation'
        : 'Install for standalone manager';
  const link = document.getElementById('setup-pr-link');
  link.textContent = '';
  if (setup.pullRequest && setup.pullRequest.url) {
    const anchor = document.createElement('a');
    anchor.href = setup.pullRequest.url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = 'Setup PR #' + setup.pullRequest.number + ': ' + setup.pullRequest.state;
    link.append(anchor);
  } else if (setup.externalController) {
    link.textContent = 'No setup PR is currently recorded.';
  }
}

document.getElementById('install-external-controller').addEventListener('click', async () => {
  if (!currentStatus || !confirm('Install the selected repository for the standalone manager? This creates or reuses the issue template, labels, and workspace without adding a package dependency or lockfile entry.')) return;
  try {
    await postRepositoryAction('install/external');
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
      'Manager-wide fair coding capacity, repository PR-review schedulers, and external repository installation are available.',
    )
    .replace('</body>', `${INSTALL_SCRIPT}\n</body>`);
}
