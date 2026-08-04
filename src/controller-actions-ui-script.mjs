export const CONTROLLER_ACTIONS_UI_SCRIPT = String.raw`
(function installControllerActionsUi() {
  function controllerIsOperational(data) {
    return Boolean(data.config && data.config.setupComplete && data.checks && data.checks.ready);
  }

  function repositoryIsReadable(data) {
    return Boolean(data.requirements && data.requirements.git && data.requirements.githubAuthenticated && data.requirements.remote);
  }

  function updateActionButton(button, options) {
    if (!button) return;
    button.textContent = options.text;
    button.disabled = Boolean(options.disabled);
    button.className = options.className || '';
    button.title = options.title || '';
  }

  window.toggleClaims = function() {
    const controller = dashboardData && dashboardData.automation && dashboardData.automation.controller;
    if (!controller || !controllerIsOperational(dashboardData)) return;
    const pausing = Boolean(controller.claimsEnabled);
    return postAction(
      pausing ? '/api/pause' : '/api/resume',
      {},
      pausing ? 'Claims paused.' : 'Claims resumed.',
    );
  };

  window.renderHealth = function(data) {
    const controller = data.automation && data.automation.controller || {};
    const capacity = controller.capacity || { active: 0, maximum: data.config.maxActive };
    const operational = controllerIsOperational(data);
    const repositoryReadable = repositoryIsReadable(data);
    const claimsEnabled = Boolean(controller.claimsEnabled);
    const dependencyApiAvailable = Boolean(controller.dependencyApiAvailable);

    setChip('health-claims', operational ? (claimsEnabled ? 'Claims running' : 'Claims paused') : 'Claims unavailable', operational ? (claimsEnabled ? 'good' : 'warn') : 'bad');
    setChip('health-capacity', 'Capacity ' + capacity.active + ' / ' + capacity.maximum, operational && capacity.active < capacity.maximum ? 'good' : 'info');
    setChip('health-poll', controller.nextPollAt ? 'Next poll ' + formatRelative(controller.nextPollAt) : 'Next poll pending', 'info');
    setChip('health-github', data.requirements.githubAuthenticated ? 'GitHub connected' : 'GitHub disconnected', data.requirements.githubAuthenticated ? 'good' : 'bad');
    setChip('health-paseo', data.requirements.paseoReachable ? 'Paseo connected' : 'Paseo unavailable', data.requirements.paseoReachable ? 'good' : 'bad');
    setChip('health-dependencies', dependencyApiAvailable ? 'Native dependencies available' : 'Dependency API unavailable', dependencyApiAvailable ? 'good' : 'bad');

    const actionBar = document.getElementById('controller-actions');
    const actionState = document.getElementById('controller-action-state');
    const toggle = document.getElementById('claims-toggle-button');

    if (actionBar) {
      actionBar.classList.remove('hidden');
      actionBar.dataset.state = operational ? (claimsEnabled ? 'running' : 'paused') : repositoryReadable ? 'read-only' : 'setup-required';
    }

    if (actionState) {
      actionState.textContent = operational
        ? (claimsEnabled ? 'Controller running' : 'Controller paused')
        : repositoryReadable ? 'Read-only discovery' : 'Setup required';
      actionState.className = 'chip ' + (operational ? (claimsEnabled ? 'good' : 'warn') : repositoryReadable ? 'info' : 'bad');
    }

    updateActionButton(toggle, operational ? {
      text: claimsEnabled ? 'Pause claims' : 'Resume claims',
      disabled: false,
      className: claimsEnabled ? 'danger' : '',
      title: claimsEnabled ? 'Stop claiming new issues. Active work is not cancelled.' : 'Allow the controller to claim eligible issues.',
    } : {
      text: 'Claims unavailable',
      disabled: true,
      className: 'secondary',
      title: 'Complete the required setup checks before enabling claims.',
    });

    document.getElementById('subtitle').textContent = operational
      ? 'Autonomous GitHub issue coding through Paseo · Base ' + data.config.baseBranch
      : repositoryReadable
        ? 'Repository issues and native dependencies are available read-only. Complete setup to enable autonomous execution.'
        : 'Connect the GitHub repository to load issues and dependencies.';
  };

  renderHealth = window.renderHealth;
})();
`;
