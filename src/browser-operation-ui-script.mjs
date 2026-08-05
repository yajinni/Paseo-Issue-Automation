export const BROWSER_OPERATION_UI_SCRIPT = String.raw`
(function installBrowserOperationProgress() {
  const INSTALL_PATH = '/api/pr-reviews/browser/install';
  const UNINSTALL_PATH = '/api/pr-reviews/browser/uninstall';
  let operationActive = false;
  let elapsedTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  function installStyles() {
    if (document.getElementById('browser-operation-style')) return;
    const style = document.createElement('style');
    style.id = 'browser-operation-style';
    style.textContent = [
      '#browser-operation-dialog{width:min(720px,calc(100vw - 28px));padding:0;overflow:hidden}',
      '#browser-operation-dialog .browser-operation-body{display:grid;gap:14px;padding:18px}',
      '#browser-operation-dialog .browser-operation-command{display:block;padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:#070b12;color:#dbe9ff;white-space:pre-wrap;overflow-wrap:anywhere}',
      '#browser-operation-dialog .browser-operation-state{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '#browser-operation-dialog .browser-operation-state strong{display:flex;align-items:center;gap:8px}',
      '#browser-operation-dialog .browser-operation-spinner{width:14px;height:14px;border:2px solid rgba(88,166,255,.25);border-top-color:var(--accent);border-radius:50%;animation:browser-operation-spin .8s linear infinite}',
      '#browser-operation-dialog[data-state="success"] .browser-operation-spinner{border:0;animation:none;width:auto;height:auto}',
      '#browser-operation-dialog[data-state="success"] .browser-operation-spinner:before{content:"✓";color:var(--success)}',
      '#browser-operation-dialog[data-state="failed"] .browser-operation-spinner{border:0;animation:none;width:auto;height:auto}',
      '#browser-operation-dialog[data-state="failed"] .browser-operation-spinner:before{content:"×";color:var(--danger)}',
      '#browser-operation-dialog .browser-operation-track{height:8px;overflow:hidden;border-radius:999px;background:var(--panel-3)}',
      '#browser-operation-dialog .browser-operation-track span{display:block;width:38%;height:100%;border-radius:inherit;background:var(--accent);animation:browser-operation-progress 1.35s ease-in-out infinite}',
      '#browser-operation-dialog[data-state="success"] .browser-operation-track span{width:100%;animation:none;background:var(--success)}',
      '#browser-operation-dialog[data-state="failed"] .browser-operation-track span{width:100%;animation:none;background:var(--danger)}',
      '#browser-operation-output{min-height:120px;max-height:300px;margin:0;padding:12px 14px;overflow:auto;border:1px solid var(--border);border-radius:9px;background:#070b12;color:#c8d5e8;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
      '@keyframes browser-operation-spin{to{transform:rotate(360deg)}}',
      '@keyframes browser-operation-progress{0%{transform:translateX(-120%)}50%{transform:translateX(120%)}100%{transform:translateX(270%)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureDialog() {
    let dialog = document.getElementById('browser-operation-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'browser-operation-dialog';
    dialog.dataset.state = 'idle';
    dialog.innerHTML = [
      '<div class="dialog-head">',
        '<div><h2 id="browser-operation-title">Chromium operation</h2><p class="muted" id="browser-operation-description">Preparing command…</p></div>',
        '<button id="browser-operation-header-close" class="ghost small" type="button" disabled>Close</button>',
      '</div>',
      '<div class="browser-operation-body">',
        '<div><div class="muted" style="margin-bottom:6px">Command</div><code id="browser-operation-command" class="browser-operation-command"></code></div>',
        '<div class="browser-operation-state"><strong><span class="browser-operation-spinner" aria-hidden="true"></span><span id="browser-operation-status">Starting…</span></strong><span id="browser-operation-elapsed" class="muted">0 seconds</span></div>',
        '<div class="browser-operation-track" role="progressbar" aria-label="Chromium operation progress"><span></span></div>',
        '<div><div class="muted" style="margin-bottom:6px">Command output</div><pre id="browser-operation-output" aria-live="polite">Waiting for the command to start…</pre></div>',
      '</div>',
      '<div class="dialog-footer"><button id="browser-operation-close" class="secondary" type="button" disabled>Close</button></div>'
    ].join('');
    document.body.appendChild(dialog);

    const close = function() {
      if (!operationActive) dialog.close();
    };
    document.getElementById('browser-operation-close').addEventListener('click', close);
    document.getElementById('browser-operation-header-close').addEventListener('click', close);
    dialog.addEventListener('cancel', function(event) {
      if (operationActive) event.preventDefault();
    });
    return dialog;
  }

  function renameUninstallControl() {
    Array.from(document.querySelectorAll('button')).forEach(function(button) {
      if (String(button.textContent || '').trim().toLowerCase() !== 'uninstall browser') return;
      button.textContent = 'Uninstall Chromium';
      button.title = 'Remove Playwright Chromium while preserving the dedicated ChatGPT profile, login, and selected conversation.';
      button.setAttribute(
        'onclick',
        "openPrReviewConfirm('Uninstall Chromium','UNINSTALL','/api/pr-reviews/browser/uninstall')",
      );
    });
  }

  function initialCommand(path) {
    return path === INSTALL_PATH
      ? 'npx playwright install chromium'
      : 'npx playwright uninstall';
  }

  function operationResult(path, payload) {
    return path === UNINSTALL_PATH ? (payload && payload.browsers || payload || {}) : (payload || {});
  }

  function formatOutput(path, payload) {
    const result = operationResult(path, payload);
    const lines = [];
    const command = Array.isArray(result.command) ? result.command.join(' ') : initialCommand(path);
    lines.push('$ ' + command);
    if (result.resolvedCommand && result.resolvedCommand !== result.command?.[0]) {
      lines.push('Resolved npx: ' + result.resolvedCommand);
    }
    lines.push('');
    lines.push(String(result.stdout || 'Command completed without additional output.').trim());
    if (result.chromium) {
      lines.push('');
      lines.push(path === INSTALL_PATH
        ? 'Verification: Chromium executable found at ' + (result.chromium.executablePath || 'the Playwright browser location') + '.'
        : 'Verification: Chromium executable is no longer present.');
    }
    if (path === UNINSTALL_PATH && payload && payload.state) {
      lines.push('ChatGPT profile preserved: ' + (payload.state.profilePreserved ? 'yes' : 'unknown') + '.');
      lines.push('ChatGPT credentials preserved: ' + (payload.state.credentialsPreserved ? 'yes' : 'not previously verified') + '.');
    }
    return lines.join('\n');
  }

  function setCloseEnabled(enabled) {
    const close = document.getElementById('browser-operation-close');
    const headerClose = document.getElementById('browser-operation-header-close');
    if (close) close.disabled = !enabled;
    if (headerClose) headerClose.disabled = !enabled;
  }

  function startElapsedClock(startedAt) {
    clearInterval(elapsedTimer);
    const node = document.getElementById('browser-operation-elapsed');
    const update = function() {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      if (node) node.textContent = seconds + (seconds === 1 ? ' second' : ' seconds');
    };
    update();
    elapsedTimer = setInterval(update, 1000);
  }

  async function refreshAfterOperation() {
    const refreshes = [];
    if (typeof window.refreshPrReviews === 'function') refreshes.push(window.refreshPrReviews(true));
    if (typeof window.refreshStatus === 'function') refreshes.push(window.refreshStatus({ force: true }));
    await Promise.allSettled(refreshes);
  }

  async function runBrowserOperation(path, body) {
    if (operationActive) {
      toast('A Chromium install or uninstall command is already running.', true);
      return null;
    }
    operationActive = true;
    installStyles();
    const dialog = ensureDialog();
    const installing = path === INSTALL_PATH;
    const title = installing ? 'Installing Chromium' : 'Uninstalling Chromium';
    const startedAt = Date.now();

    dialog.dataset.state = 'running';
    document.getElementById('browser-operation-title').textContent = title;
    document.getElementById('browser-operation-description').textContent = installing
      ? 'Playwright is downloading and installing its matching Chromium build.'
      : 'Playwright is removing its Chromium browser files. Your ChatGPT profile and login will be preserved.';
    document.getElementById('browser-operation-command').textContent = initialCommand(path);
    document.getElementById('browser-operation-status').textContent = installing ? 'Installing…' : 'Uninstalling…';
    document.getElementById('browser-operation-output').textContent = '$ ' + initialCommand(path) + '\n\nCommand is running…';
    setCloseEnabled(false);
    startElapsedClock(startedAt);
    if (!dialog.open) dialog.showModal();

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { error: text || 'The server returned an unreadable response.' }; }
      if (!response.ok) throw new Error(payload.error || 'Chromium operation failed.');

      const result = operationResult(path, payload);
      const command = Array.isArray(result.command) ? result.command.join(' ') : initialCommand(path);
      document.getElementById('browser-operation-command').textContent = command;
      document.getElementById('browser-operation-output').textContent = formatOutput(path, payload);
      document.getElementById('browser-operation-status').textContent = installing ? 'Chromium installed' : 'Chromium uninstalled';
      dialog.dataset.state = 'success';
      toast(installing ? 'Chromium installed and verified.' : 'Chromium uninstalled and verified.');
      await refreshAfterOperation();
      return payload;
    } catch (error) {
      dialog.dataset.state = 'failed';
      document.getElementById('browser-operation-status').textContent = installing ? 'Installation failed' : 'Uninstall failed';
      document.getElementById('browser-operation-output').textContent = '$ ' + initialCommand(path) + '\n\n' + String(error && error.message || error);
      toast(String(error && error.message || error), true);
      return null;
    } finally {
      operationActive = false;
      clearInterval(elapsedTimer);
      elapsedTimer = null;
      setCloseEnabled(true);
    }
  }

  function install() {
    installStyles();
    ensureDialog();
    renameUninstallControl();

    const originalPost = window.prReviewPost;
    if (typeof originalPost === 'function' && !originalPost.browserOperationWrapped) {
      const wrapped = function(path, body) {
        if (path === INSTALL_PATH || path === UNINSTALL_PATH) {
          return runBrowserOperation(path, body);
        }
        return originalPost(path, body);
      };
      wrapped.browserOperationWrapped = true;
      window.prReviewPost = wrapped;
      prReviewPost = wrapped;
    }

    const observer = new MutationObserver(renameUninstallControl);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;
