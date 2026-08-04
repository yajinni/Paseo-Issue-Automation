export const COMPONENTS_UI_SCRIPT = String.raw`
(function installComponentsUi() {
  let latestData = null;
  let operationInFlight = false;

  function componentState(data) {
    const management = data.integration && data.integration.management || {};
    const issue = management.issueTemplate || {};
    const paseo = management.paseoJson || {};
    const labels = Object.values(data.integration && data.integration.labels || {});
    const issueHealthy = Boolean(issue.present && !issue.changedSinceInstall);
    const paseoHealthy = Boolean(paseo.servicePresent && !paseo.changedSinceInstall);
    const labelsHealthy = labels.length > 0 && labels.every(function(label) {
      return label.present && !label.canRepair;
    });
    const workspaceHealthy = Boolean(data.workspace && data.workspace.id);
    return {
      issue: issue,
      paseo: paseo,
      labels: labels,
      issueHealthy: issueHealthy,
      paseoHealthy: paseoHealthy,
      labelsHealthy: labelsHealthy,
      workspaceHealthy: workspaceHealthy,
      allHealthy: issueHealthy && paseoHealthy && labelsHealthy && workspaceHealthy
    };
  }

  function setComponentStatus(badgeId, reinstallId, healthy) {
    const badge = document.getElementById(badgeId);
    const reinstall = document.getElementById(reinstallId);
    if (badge) {
      badge.innerHTML = '<span class="status-dot ' + (healthy ? 'good' : 'bad') + '" title="' + (healthy ? 'Installed' : 'Needs attention') + '"></span>';
    }
    if (reinstall) {
      reinstall.classList.toggle('hidden', healthy);
      reinstall.disabled = operationInFlight;
    }
  }

  function renderComponents(data) {
    latestData = data;
    const state = componentState(data);
    const action = document.getElementById('components-action');
    const card = document.getElementById('installation-card');
    const labelsStatus = document.getElementById('labels-status');

    setComponentStatus('issue-template-badge', 'reinstall-issue-template', state.issueHealthy);
    setComponentStatus('paseo-json-badge', 'reinstall-paseo-service', state.paseoHealthy);
    setComponentStatus('labels-badge', 'reinstall-labels', state.labelsHealthy);
    setComponentStatus('workspace-badge', 'reinstall-workspace', state.workspaceHealthy);

    if (labelsStatus) {
      const present = state.labels.filter(function(label) { return label.present; }).length;
      const needsRepair = state.labels.filter(function(label) { return !label.present || label.canRepair; }).length;
      if (!state.labels.length) {
        labelsStatus.textContent = 'Checking GitHub lifecycle labels…';
      } else if (state.labelsHealthy) {
        labelsStatus.textContent = 'All ' + state.labels.length + ' GitHub lifecycle labels are available.';
      } else {
        labelsStatus.textContent = present + ' of ' + state.labels.length + ' labels are available; ' + needsRepair + ' need attention.';
      }
    }

    if (action) {
      action.textContent = state.allHealthy ? 'Uninstall components' : 'Install components';
      action.className = state.allHealthy ? 'danger' : '';
      action.disabled = operationInFlight;
      action.dataset.mode = state.allHealthy ? 'uninstall' : 'install';
    }
    if (card) card.classList.toggle('done', state.allHealthy);
  }

  async function post(path, body) {
    return api(path, {
      method: 'POST',
      body: JSON.stringify(body || {})
    });
  }

  async function runOperation(pendingLabel, successLabel, operation) {
    if (operationInFlight) return;
    operationInFlight = true;
    if (latestData) renderComponents(latestData);
    const action = document.getElementById('components-action');
    if (action) action.textContent = pendingLabel;
    try {
      const response = await operation();
      if (response && response.snapshot) render(response.snapshot);
      else await refreshStatus();
      toast(successLabel);
    } catch (error) {
      toast(error && error.message ? error.message : 'The component operation failed.', true);
    } finally {
      operationInFlight = false;
      if (latestData) renderComponents(latestData);
    }
  }

  async function installComponents() {
    return runOperation('Installing…', 'Components installed or reconnected.', async function() {
      await post('/api/install');
      return post('/api/workspace');
    });
  }

  async function uninstallComponents() {
    return runOperation('Uninstalling…', 'Package-owned components were uninstalled.', function() {
      return post('/api/uninstall', {
        issueTemplate: true,
        paseoService: true,
        labels: true,
        workspace: true,
        localState: false,
        forceLabels: false
      });
    });
  }

  window.componentsAction = function() {
    if (!latestData || operationInFlight) return;
    const state = componentState(latestData);
    if (state.allHealthy) {
      openActionDialog(
        'Uninstall components',
        'Remove only package-owned components. Local ownership state and the npm package will remain.',
        '<p class="muted">Pre-existing matching files, labels, services, or workspaces are preserved.</p>',
        'Uninstall components',
        uninstallComponents,
        true
      );
      return;
    }
    openActionDialog(
      'Install components',
      'Install or reconnect the issue template, Paseo service, GitHub labels, and permanent workspace.',
      '<p class="muted">Existing matching components are reused. Unrelated repository content is preserved.</p>',
      'Install components',
      installComponents,
      false
    );
  };

  window.reinstallComponent = function(name) {
    if (!latestData || operationInFlight) return;
    const state = componentState(latestData);
    if (name === 'issueTemplate') {
      return runOperation('Repairing…', 'Issue template reinstalled.', function() {
        return post(state.issue.canRepair ? '/api/repair/issue-template' : '/api/install/issue-template');
      });
    }
    if (name === 'paseoService') {
      return runOperation('Repairing…', 'Paseo service reinstalled.', function() {
        return post(state.paseo.canRepair ? '/api/repair/paseo-service' : '/api/install/paseo-service');
      });
    }
    if (name === 'labels') {
      const labels = state.labels.filter(function(label) { return !label.present || label.canRepair; });
      return runOperation('Repairing…', 'GitHub lifecycle labels reinstalled.', async function() {
        let response = null;
        for (const label of labels) {
          response = await post('/api/repair/label', { label: label.name });
        }
        return response || post('/api/install/labels');
      });
    }
    if (name === 'workspace') {
      return runOperation('Reconnecting…', 'Permanent Paseo workspace reinstalled.', function() {
        return post('/api/workspace');
      });
    }
  };

  const previousRenderSettings = window.renderSettings;
  if (typeof previousRenderSettings === 'function') {
    window.renderSettings = function(data) {
      previousRenderSettings(data);
      renderComponents(data);
    };
    renderSettings = window.renderSettings;
  }
})();
`;
