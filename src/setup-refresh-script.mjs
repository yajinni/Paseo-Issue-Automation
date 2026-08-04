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

  function cloneAndWire(id, label) {
    const existing = document.getElementById(id);
    if (!existing) return null;
    const button = existing.cloneNode(true);
    button.disabled = false;
    button.textContent = label;
    existing.replaceWith(button);
    button.addEventListener('click', function() { authoritativeRefresh(button); });
    return button;
  }

  function wireButtons() {
    cloneAndWire('requirements-check-again', 'Check again');
    cloneAndWire('refresh-setup-options', 'Refresh branches and models');
    cloneAndWire('requirement-details-recheck', 'Check again');
  }

  function allRefreshButtons() {
    return [
      document.getElementById('requirements-check-again'),
      document.getElementById('refresh-setup-options'),
      document.getElementById('requirement-details-recheck')
    ].filter(Boolean);
  }

  async function authoritativeRefresh(clickedButton) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const buttons = allRefreshButtons();
    const originalLabels = new Map(buttons.map(function(button) { return [button, button.textContent]; }));
    buttons.forEach(function(button) {
      button.disabled = true;
      button.textContent = 'Checking…';
    });
    renderPendingRows('Checking now…', false);

    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, 25_000);
    try {
      const data = await api('/api/status?refresh=setup&_=' + Date.now(), { signal: controller.signal });
      render(data);
      wireButtons();
      toast('Requirements, branches, Paseo harnesses, and models were rechecked.');
      return data;
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'The recheck exceeded 25 seconds and was stopped. No button will remain stuck.'
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
