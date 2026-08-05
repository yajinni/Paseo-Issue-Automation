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
      '#browser-operation-dialog{position:fixed;inset:24px auto auto 50%;transform:translateX(-50%);width:min(380px,calc(100vw - 28px));margin:0;padding:0;overflow:hidden;z-index:1000}',
      '#browser-operation-dialog .browser-operation-body{display:grid;justify-items:center;gap:14px;padding:24px;text-align:center}',
      '#browser-operation-dialog .browser-operation-spinner{width:28px;height:28px;border:3px solid rgba(88,166,255,.25);border-top-color:var(--accent);border-radius:50%;animation:browser-operation-spin .8s linear infinite}',
      '#browser-operation-dialog[data-state="failed"] .browser-operation-spinner{display:none}',
      '#browser-operation-error{width:100%;max-height:180px;margin:0;padding:10px 12px;overflow:auto;border:1px solid var(--danger);border-radius:8px;background:#070b12;color:#ffd6d6;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}',
      '#browser-operation-close[hidden]{display:none}',
      '@keyframes browser-operation-spin{to{transform:rotate(360deg)}}'
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
      '<div class="browser-operation-body">',
        '<div class="browser-operation-spinner" aria-hidden="true"></div>',
        '<div><h2 id="browser-operation-title" style="margin:0 0 8px">Chromium operation</h2><p id="browser-operation-description" class="muted" style="margin:0"></p></div>',
        '<pre id="browser-operation-error" hidden aria-live="polite"></pre>',
        '<button id="browser-operation-close" class="secondary" type="button" hidden>Close</button>',
      '</div>'
    ].join('');
    document.body.appendChild(dialog);
    document.getElementById('browser-operation-close').addEventListener('click', function() {
      if (!operationActive) dialog.close();
    });
    return dialog;
  }

  function prepareDialog(installing) {
    installStyles();
    const dialog = ensureDialog();
    dialog.dataset.state = 'running';
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
    if (!dialog.open) dialog.show();
    return dialog;
  }

  function showFailure(dialog, installing, error) {
    operationActive = false;
    dialog.dataset.state = 'failed';
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
    let dialog;
    try {
      dialog = prepareDialog(installing);
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
      dialog.close();
      toast(installing
        ? 'Chromium installed and verified.'
        : 'Chromium and dedicated browser state removed and verified.');
      refreshAfterOperation().catch(function() {});
      return payload;
    } catch (error) {
      showFailure(dialog, installing, error);
      toast(String(error && error.message || error), true);
      return null;
    }
  }

  window.installPrReviewBrowser = function() {
    return runBrowserOperation(INSTALL_PATH);
  };

  window.confirmChromiumUninstall = function() {
    const dialog = document.getElementById('pr-confirm-dialog');
    const input = document.getElementById('pr-confirm-input');
    const confirm = document.getElementById('pr-confirm-button');
    document.getElementById('pr-confirm-title').textContent = 'Uninstall Chromium';
    document.getElementById('pr-confirm-text').textContent = 'Type UNINSTALL to continue. This also deletes the dedicated ChatGPT profile, login, selected conversation, and local browser state.';
    input.value = '';
    confirm.disabled = true;
    input.oninput = function() {
      confirm.disabled = input.value !== 'UNINSTALL';
    };
    confirm.onclick = function() {
      confirm.disabled = true;
      const startUninstall = function() {
        setTimeout(function() {
          runBrowserOperation(UNINSTALL_PATH);
        }, 0);
      };
      if (dialog.open) {
        dialog.addEventListener('close', startUninstall, { once: true });
        dialog.close();
      } else {
        startUninstall();
      }
    };
    dialog.showModal();
    input.focus();
  };

  function bindUninstallControl() {
    Array.from(document.querySelectorAll('button')).forEach(function(button) {
      const text = String(button.textContent || '').trim().toLowerCase();
      if (text !== 'uninstall browser' && text !== 'uninstall chromium') return;
      button.textContent = 'Uninstall Chromium';
      button.title = 'Remove Playwright Chromium and delete the dedicated ChatGPT profile, login, selected conversation, and local browser state.';
      button.removeAttribute('onclick');
      button.onclick = window.confirmChromiumUninstall;
    });
  }

  bindUninstallControl();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUninstallControl, { once: true });
  }
})();
`;
