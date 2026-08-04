export const SETUP_REFRESH_SCRIPT = String.raw`
(function installRecoverableSetupRefresh() {
  const labels = ['Git', 'GitHub CLI', 'GitHub authenticated', 'Paseo CLI', 'Paseo reachable', 'GitHub remote'];
  let refreshInFlight = false;

  function requirementsContainer() {
    return document.getElementById('requirements');
  }

  function renderPendingRows(message, bad) {
    const container = requirementsContainer();
    if (!container) return;
    container.replaceChildren();
    labels.forEach(function(label) {
      const row = document.createElement('div');
      row.className = 'component';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'auto minmax(0, 1fr) auto';
      row.style.alignItems = 'center';
      row.style.gap = '12px';
      row.innerHTML = [
        '<button type="button" class="small secondary" disabled>Details</button>',
        '<div><strong>' + label + '</strong><p style="margin:4px 0 0" class="' + (bad ? 'bad-text' : 'muted') + '">' + message + '</p></div>',
        '<span class="status-dot ' + (bad ? 'bad' : '') + '"></span>'
      ].join('');
      container.appendChild(row);
    });
  }

  function cloneAndWire(id, label, mode) {
    const existing = document.getElementById(id);
    if (!existing) return null;
    const button = existing.cloneNode(true);
    button.disabled = false;
    button.textContent = label;
    existing.replaceWith(button);
    button.addEventListener('click', function() { authoritativeRefresh(button, mode); });
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

  async function authoritativeRefresh(clickedButton, mode) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const catalogRefresh = mode === 'catalog';
    const buttons = allRefreshButtons();
    const originalLabels = new Map(buttons.map(function(button) { return [button, button.textContent]; }));
    buttons.forEach(function(button) {
      button.disabled = true;
      button.textContent = catalogRefresh ? 'Loading models…' : 'Checking…';
    });
    renderPendingRows(catalogRefresh ? 'Refreshing setup data…' : 'Checking requirements now…', false);

    const controller = new AbortController();
    const timeoutMs = catalogRefresh ? 25_000 : 12_000;
    const timeout = setTimeout(function() { controller.abort(); }, timeoutMs);
    const refreshValue = catalogRefresh ? 'setup' : 'requirements';
    try {
      const data = await api('/api/status?refresh=' + refreshValue + '&_=' + Date.now(), { signal: controller.signal });
      render(data);
      wireButtons();
      toast(catalogRefresh
        ? 'Branches, Paseo harnesses, and models were refreshed.'
        : 'Git, GitHub, Paseo, and remote requirements were rechecked.');
      return data;
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'The recheck exceeded ' + Math.round(timeoutMs / 1000) + ' seconds and was stopped. No button will remain stuck.'
        : (error && error.message ? error.message : 'The recheck failed.');
      renderPendingRows(message, true);
      toast(message, true);
      return null;
    } finally {
      clearTimeout(timeout);
      refreshInFlight = false;
      allRefreshButtons().forEach(function(button) {
        button.disabled = false;
        if (button.id === 'refresh-setup-options') button.textContent = 'Refresh branches and models';
        else button.textContent = 'Check again';
      });
      buttons.forEach(function(button) {
        if (button.isConnected && originalLabels.has(button)) {
          button.disabled = false;
          button.textContent = originalLabels.get(button);
        }
      });
      if (clickedButton && clickedButton.isConnected) clickedButton.disabled = false;
    }
  }

  window.authoritativeSetupRefresh = authoritativeRefresh;

  const container = requirementsContainer();
  if (container && !container.children.length) renderPendingRows('Waiting for the first check…', false);
  wireButtons();
})();
`;
