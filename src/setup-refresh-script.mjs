export const SETUP_REFRESH_SCRIPT = String.raw`
(function installProgressiveSetupRefresh() {
  const requirements = [
    { id: 'git', label: 'Git' },
    { id: 'githubCli', label: 'GitHub CLI' },
    { id: 'githubAuthenticated', label: 'GitHub authenticated' },
    { id: 'paseoCli', label: 'Paseo CLI' },
    { id: 'paseoReachable', label: 'Paseo reachable' },
    { id: 'remote', label: 'GitHub remote' }
  ];
  let refreshInFlight = false;
  let initialCheckStarted = false;

  function requirementsContainer() {
    return document.getElementById('requirements');
  }

  function progressRow(id) {
    return document.getElementById('setup-progress-' + id);
  }

  function renderPendingRows(message) {
    const container = requirementsContainer();
    if (!container) return;
    container.replaceChildren();
    requirements.forEach(function(requirement) {
      const row = document.createElement('div');
      row.id = 'setup-progress-' + requirement.id;
      row.className = 'component';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'auto minmax(0, 1fr) auto';
      row.style.alignItems = 'center';
      row.style.gap = '12px';
      row.innerHTML = [
        '<button type="button" class="small secondary" disabled>Details</button>',
        '<div><strong>' + requirement.label + '</strong><p style="margin:4px 0 0" class="muted">' + message + '</p></div>',
        '<span class="status-dot"></span>'
      ].join('');
      container.appendChild(row);
    });
  }

  function updateProgressRow(id, state) {
    const row = progressRow(id);
    if (!row) return;
    const message = row.querySelector('p');
    const dot = row.querySelector('.status-dot');
    if (message) {
      message.textContent = state.value || (state.ok ? 'Requirement passed.' : 'Requirement failed.');
      message.className = state.ok ? 'good-text' : 'bad-text';
    }
    if (dot) {
      dot.className = 'status-dot ' + (state.ok ? 'good' : 'bad');
      dot.title = state.ok ? 'Passing' : 'Needs attention';
    }
  }

  function cloneAndWire(id, label, mode) {
    const existing = document.getElementById(id);
    if (!existing) return null;
    const button = existing.cloneNode(true);
    button.disabled = false;
    button.textContent = label;
    existing.replaceWith(button);
    button.addEventListener('click', function() {
      if (mode === 'requirements') progressiveRequirements(button, false);
      else authoritativeRefresh(button, 'catalog');
    });
    return button;
  }

  function wireButtons() {
    cloneAndWire('requirements-check-again', 'Check again', 'requirements');
    cloneAndWire('refresh-setup-options', 'Refresh branches and models', 'catalog');
    cloneAndWire('requirement-details-recheck', 'Check again', 'requirements');
  }

  function allRefreshButtons() {
    return [
      document.getElementById('requirements-check-again'),
      document.getElementById('refresh-setup-options'),
      document.getElementById('requirement-details-recheck')
    ].filter(Boolean);
  }

  function setButtonsBusy(message) {
    allRefreshButtons().forEach(function(button) {
      button.disabled = true;
      button.textContent = message;
    });
  }

  function restoreButtons() {
    allRefreshButtons().forEach(function(button) {
      button.disabled = false;
      button.textContent = button.id === 'refresh-setup-options' ? 'Refresh branches and models' : 'Check again';
    });
  }

  async function apiWithTimeout(path, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, timeoutMs);
    try {
      return await api(path, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  function improveCatalogStatus(data) {
    const status = document.getElementById('setup-options-status');
    if (!status) return;
    const options = data.setupOptions || {};
    const catalog = options.catalog || {};
    const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
    const errors = Array.isArray(catalog.errors) ? catalog.errors.filter(Boolean) : [];
    const models = providers.reduce(function(total, provider) {
      return total + (Array.isArray(provider.models) ? provider.models.length : 0);
    }, 0);
    const branches = options.branches && Array.isArray(options.branches.branches) ? options.branches.branches.length : 0;
    const checked = data.setupCheckedAt ? ' Checked ' + new Date(data.setupCheckedAt).toLocaleTimeString() + '.' : '';

    if (!data.requirements || !data.requirements.paseoReachable) {
      status.textContent = (data.requirements && data.requirements.paseoMessage || 'Paseo is not reachable.') + checked;
      status.className = 'muted bad-text';
      return;
    }
    if (catalog.skipped) {
      status.textContent = 'Paseo is reachable. Harness and model discovery has not run yet; it will start automatically.' + checked;
      status.className = 'muted';
      return;
    }
    if (!providers.length) {
      status.textContent = 'Paseo is reachable, but no usable harnesses were loaded. ' + (errors[0] || 'Run Refresh branches and models for diagnostics.') + checked;
      status.className = 'muted bad-text';
      return;
    }
    status.textContent = 'Paseo is reachable. Loaded ' + branches + ' branches, ' + providers.length + ' harnesses, and ' + models + ' models.'
      + (errors.length ? ' Some providers reported problems: ' + errors.join(' | ') : '') + checked;
    status.className = 'muted ' + (errors.length ? 'bad-text' : 'good-text');
  }

  async function progressiveRequirements(clickedButton, autoCatalog) {
    if (refreshInFlight) return null;
    refreshInFlight = true;
    setButtonsBusy('Checking…');
    renderPendingRows('Waiting to be checked…');
    let fullData = null;
    try {
      for (const requirement of requirements) {
        const row = progressRow(requirement.id);
        const message = row && row.querySelector('p');
        if (message) {
          message.textContent = 'Checking now…';
          message.className = 'muted';
        }
        try {
          const result = await apiWithTimeout(
            '/api/setup/requirement?name=' + encodeURIComponent(requirement.id) + '&refresh=1&_=' + Date.now(),
            requirement.id === 'paseoReachable' ? 8_000 : 7_000
          );
          updateProgressRow(requirement.id, result);
        } catch (error) {
          updateProgressRow(requirement.id, {
            ok: false,
            value: error && error.name === 'AbortError'
              ? 'This check exceeded its time limit.'
              : (error && error.message ? error.message : 'The check failed.')
          });
        }
      }

      fullData = await apiWithTimeout('/api/status?_=' + Date.now(), 20_000);
      render(fullData);
      wireButtons();
      improveCatalogStatus(fullData);
      toast('Git, GitHub, Paseo, and remote requirements were checked.');
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'The setup snapshot exceeded 20 seconds. Completed requirement results remain visible.'
        : (error && error.message ? error.message : 'The setup check failed.');
      toast(message, true);
    } finally {
      refreshInFlight = false;
      restoreButtons();
      if (clickedButton && clickedButton.isConnected) clickedButton.disabled = false;
    }

    if (autoCatalog
      && fullData
      && fullData.requirements
      && fullData.requirements.paseoReachable
      && fullData.setupOptions
      && fullData.setupOptions.catalog
      && fullData.setupOptions.catalog.skipped) {
      return authoritativeRefresh(document.getElementById('refresh-setup-options'), 'catalog');
    }
    return fullData;
  }

  async function authoritativeRefresh(clickedButton, mode) {
    if (mode !== 'catalog') return progressiveRequirements(clickedButton, false);
    if (refreshInFlight) return null;
    refreshInFlight = true;
    setButtonsBusy('Loading models…');
    const status = document.getElementById('setup-options-status');
    if (status) {
      status.textContent = 'Asking Paseo for enabled harnesses and their models…';
      status.className = 'muted';
    }
    try {
      const data = await apiWithTimeout('/api/status?refresh=setup&_=' + Date.now(), 40_000);
      render(data);
      wireButtons();
      improveCatalogStatus(data);
      const catalog = data.setupOptions && data.setupOptions.catalog || {};
      const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
      const errors = Array.isArray(catalog.errors) ? catalog.errors.filter(Boolean) : [];
      if (!providers.length) {
        toast(errors[0] || 'Paseo did not report any usable harnesses.', true);
      } else if (errors.length) {
        toast('Harnesses loaded, but some provider diagnostics need attention.', true);
      } else {
        toast('Branches, Paseo harnesses, and models were refreshed.');
      }
      return data;
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'Harness and model discovery exceeded 40 seconds and was stopped.'
        : (error && error.message ? error.message : 'Harness and model discovery failed.');
      if (status) {
        status.textContent = message;
        status.className = 'muted bad-text';
      }
      toast(message, true);
      return null;
    } finally {
      refreshInFlight = false;
      restoreButtons();
      if (clickedButton && clickedButton.isConnected) clickedButton.disabled = false;
    }
  }

  window.authoritativeSetupRefresh = authoritativeRefresh;
  window.progressiveSetupRequirements = progressiveRequirements;

  const previousRenderSettings = window.renderSettings;
  if (typeof previousRenderSettings === 'function') {
    window.renderSettings = function(data) {
      previousRenderSettings(data);
      improveCatalogStatus(data);
      wireButtons();
    };
    renderSettings = window.renderSettings;
  }

  const container = requirementsContainer();
  if (container && !container.children.length) renderPendingRows('Waiting to be checked…');
  wireButtons();

  document.addEventListener('DOMContentLoaded', function() {
    if (location.hash === '#settings' && !initialCheckStarted) {
      initialCheckStarted = true;
      progressiveRequirements(null, true);
    }
  });
})();
`;
