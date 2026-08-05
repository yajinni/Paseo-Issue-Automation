export const BROWSER_OPERATION_UI_SCRIPT = String.raw`
(function installBrowserOperationProgress() {
  const INSTALL_PATH = '/api/pr-reviews/browser/install';
  const UNINSTALL_PATH = '/api/pr-reviews/browser/uninstall';
  let operationActive = false;

  function installStyles() {
    if (document.getElementById('browser-operation-style')) return;
    const style = document.createElement('style');
    style.id = 'browser-operation-style';
    style.textContent = [
      '#browser-operation-panel,#browser-uninstall-confirm{position:fixed;top:24px;left:50%;transform:translateX(-50%);width:min(380px,calc(100vw - 28px));margin:0;padding:0;overflow:hidden;z-index:1000;border:1px solid var(--border-strong);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:var(--shadow)}',
      '#browser-operation-panel[hidden],#browser-uninstall-confirm[hidden]{display:none!important}',
      '#browser-operation-panel .browser-operation-body,#browser-uninstall-confirm .browser-operation-body{display:grid;justify-items:center;gap:14px;padding:24px;text-align:center}',
      '#browser-operation-panel .browser-operation-spinner{width:28px;height:28px;border:3px solid rgba(88,166,255,.25);border-top-color:var(--accent);border-radius:50%;animation:browser-operation-spin .8s linear infinite}',
      '#browser-operation-panel[data-state="failed"] .browser-operation-spinner{display:none}',
      '#browser-operation-error{width:100%;max-height:180px;margin:0;padding:10px 12px;overflow:auto;border:1px solid var(--danger);border-radius:8px;background:#070b12;color:#ffd6d6;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}',
      '#browser-uninstall-confirm .browser-confirm-actions{display:flex;justify-content:center;gap:8px;width:100%}',
      '#browser-uninstall-confirm input{width:100%}',
      '#browser-operation-close[hidden]{display:none}',
      '@keyframes browser-operation-spin{to{transform:rotate(360deg)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureProgressPanel() {
    let panel = document.getElementById('browser-operation-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'browser-operation-panel';
    panel.hidden = true;
    panel.dataset.state = 'idle';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = [
      '<div class="browser-operation-body">',
        '<div class="browser-operation-spinner" aria-hidden="true"></div>',
        '<div><h2 id="browser-operation-title" style="margin:0 0 8px">Chromium operation</h2><p id="browser-operation-description" class="muted" style="margin:0"></p></div>',
        '<pre id="browser-operation-error" hidden></pre>',
        '<button id="browser-operation-close" class="secondary" type="button" hidden>Close</button>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);
    document.getElementById('browser-operation-close').addEventListener('click', function() {
      if (!operationActive) panel.hidden = true;
    });
    return panel;
  }

  function ensureConfirmationPanel() {
    let panel = document.getElementById('browser-uninstall-confirm');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'browser-uninstall-confirm';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'browser-uninstall-title');
    panel.innerHTML = [
      '<div class="browser-operation-body">',
        '<div><h2 id="browser-uninstall-title" style="margin:0 0 8px">Uninstall Chromium</h2>',
        '<p class="muted" style="margin:0">Type UNINSTALL to continue. This also deletes the dedicated ChatGPT profile, login, selected conversation, and local browser state.</p></div>',
        '<label style="width:100%;text-align:left">Confirmation phrase<input id="browser-uninstall-input" autocomplete="off"></label>',
        '<div class="browser-confirm-actions">',
          '<button id="browser-uninstall-cancel" class="secondary" type="button">Cancel</button>',
          '<button id="browser-uninstall-confirm-button" class="danger" type="button" disabled>Continue</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);
    document.getElementById('browser-uninstall-cancel').addEventListener('click', function() {
      panel.hidden = true;
    });
    return panel;
  }

  function prepareProgressPanel(installing) {
    installStyles();
    const panel = ensureProgressPanel();
    panel.dataset.state = 'running';
    panel.hidden = false;
    document.getElementById('browser-operation-title').textContent = installing
      ? 'Installing Chromium'
      : 'Uninstalling Chromium';
    document.getElementById('browser-operation-description').textContent = installing
      ? 'Expected install time: 30–60 seconds.'
      : 'Removing Chromium and dedicated browser data. This usually takes a few seconds.';
    const error = document.getElementById('browser-operation-error');
    const close = document.getElementById('browser-operation-close');
    error.hidden = true;
    error.textContent = '';
    close.hidden = true;
    return panel;
  }

  function showFailure(panel, installing, error) {
    operationActive = false;
    panel.dataset.state = 'failed';
    document.getElementById('browser-operation-title').textContent = installing
      ? 'Chromium installation failed'
      : 'Chromium uninstall failed';
    document.getElementById('browser-operation-description').textContent = 'Review the error below, then close this window and retry.';
    const errorNode = document.getElementById('browser-operation-error');
    errorNode.textContent = String(error && error.message || error);
    errorNode.hidden = false;
    document.getElementById('browser-operation-close').hidden = false;
  }

  async function refreshAfterOperation() {
    const refreshes = [];
    if (typeof window.refreshPrReviews === 'function') refreshes.push(window.refreshPrReviews(true));
    if (typeof window.refreshStatus === 'function') refreshes.push(window.refreshStatus({ force: true }));
    await Promise.allSettled(refreshes);
  }

  async function runBrowserOperation(path) {
    if (operationActive) {
      toast('A Chromium install or uninstall command is already running.', true);
      return null;
    }

    const installing = path === INSTALL_PATH;
    operationActive = true;
    const confirmation = document.getElementById('browser-uninstall-confirm');
    if (confirmation) confirmation.hidden = true;
    let panel;
    try {
      panel = prepareProgressPanel(installing);
    } catch (error) {
      operationActive = false;
      toast('Could not open the Chromium progress window: ' + String(error && error.message || error), true);
      return null;
    }

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { error: text || 'The server returned an unreadable response.' }; }
      if (!response.ok) throw new Error(payload.error || 'Chromium operation failed.');

      operationActive = false;
      panel.hidden = true;
      toast(installing
        ? 'Chromium installed and verified.'
        : 'Chromium and dedicated browser state removed and verified.');
      refreshAfterOperation().catch(function() {});
      return payload;
    } catch (error) {
      showFailure(panel, installing, error);
      toast(String(error && error.message || error), true);
      return null;
    }
  }

  window.installPrReviewBrowser = function() {
    return runBrowserOperation(INSTALL_PATH);
  };

  window.confirmChromiumUninstall = function() {
    if (operationActive) {
      toast('A Chromium install or uninstall command is already running.', true);
      return;
    }
    installStyles();
    const panel = ensureConfirmationPanel();
    const input = document.getElementById('browser-uninstall-input');
    const confirm = document.getElementById('browser-uninstall-confirm-button');
    input.value = '';
    confirm.disabled = true;
    input.oninput = function() {
      confirm.disabled = input.value !== 'UNINSTALL';
    };
    confirm.onclick = function() {
      if (input.value !== 'UNINSTALL') return;
      confirm.disabled = true;
      panel.hidden = true;
      setTimeout(function() {
        runBrowserOperation(UNINSTALL_PATH);
      }, 0);
    };
    panel.hidden = false;
    input.focus();
  };

  function bindUninstallControl() {
    Array.from(document.querySelectorAll('button')).forEach(function(button) {
      const text = String(button.textContent || '').trim().toLowerCase();
      if (text !== 'uninstall browser' && text !== 'uninstall chromium') return;
      button.type = 'button';
      button.textContent = 'Uninstall Chromium';
      button.title = 'Remove Playwright Chromium and delete the dedicated ChatGPT profile, login, selected conversation, and local browser state.';
      button.removeAttribute('onclick');
      button.onclick = function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        window.confirmChromiumUninstall();
      };
    });
  }

  bindUninstallControl();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUninstallControl, { once: true });
  }
})();
`;
