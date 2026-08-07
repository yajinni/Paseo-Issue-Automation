import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_INTERACTION_STYLE = String.raw`
#mode-banner:not(.error){display:none}
.paseo-status-chip{display:inline-flex;align-items:center;border:1px solid #526074;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;background:#182231;color:#dbe7f7}.paseo-status-chip.success{border-color:#356b4a;background:var(--paseo-success-bg);color:#b9e9ca}.paseo-status-chip.danger{border-color:#894351;background:var(--paseo-danger-bg);color:#f0c3c8}.paseo-status-chip.neutral{opacity:.82}
.paseo-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--paseo-border-strong);background:var(--paseo-secondary);color:var(--paseo-text);border-radius:9px;padding:10px 14px;font-weight:650;text-decoration:none}.paseo-action:hover{border-color:#53647c;background:#29364a}.paseo-action:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}
.manager-operation-overlay{position:fixed;inset:0;z-index:300;display:grid;place-items:center;background:#05070a99;padding:20px}.manager-operation-overlay[hidden]{display:none}.manager-operation-card{width:min(460px,100%);border:1px solid #3a485c;border-radius:14px;background:var(--paseo-panel);box-shadow:0 22px 70px #0009;padding:18px}.manager-operation-card strong{display:block;font-size:16px}.manager-operation-card p{margin:6px 0 0;color:var(--paseo-muted);line-height:1.45}.manager-operation-track{height:4px;border-radius:99px;background:#202c3c;overflow:hidden;margin-top:14px}.manager-operation-track::after{content:"";display:block;width:42%;height:100%;background:var(--paseo-primary);animation:manager-progress 1.15s ease-in-out infinite alternate}
@keyframes manager-progress{from{transform:translateX(-10%)}to{transform:translateX(155%)}}
.manager-toast-region{position:fixed;right:18px;bottom:18px;z-index:340;display:grid;gap:9px;width:min(390px,calc(100vw - 28px));pointer-events:none}.manager-toast{pointer-events:auto;border:1px solid #3a485c;border-radius:11px;background:#121923;box-shadow:0 14px 38px #0007;padding:12px 14px;color:var(--paseo-text)}.manager-toast.success{border-color:#356b4a;background:#12261a}.manager-toast.error{border-color:#894351;background:#301820}.manager-toast strong{display:block;margin-bottom:3px}.manager-toast div{color:var(--paseo-muted);font-size:13px;line-height:1.4}
.manager-modal-scrim{position:fixed;inset:0;z-index:360;display:grid;place-items:center;padding:20px;background:#05070ab8}.manager-modal-scrim[hidden]{display:none}.manager-modal{width:min(540px,100%);border:1px solid #3a485c;border-radius:14px;background:var(--paseo-panel);box-shadow:0 24px 80px #000b;padding:18px}.manager-modal h2{margin:0 0 7px;font-size:19px}.manager-modal p{margin:0;color:var(--paseo-muted);line-height:1.5}.manager-modal input{width:100%;margin-top:14px}.manager-modal-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;margin-top:18px}
button[aria-busy="true"]{cursor:progress;opacity:.72}
#dispatch-result{font-size:12px}
@media(max-width:560px){.manager-toast-region{right:14px;bottom:14px}.manager-modal-actions{display:grid;grid-template-columns:1fr 1fr}.manager-modal-actions button{width:100%}}
`;

export const MANAGER_INTERACTION_SCRIPT = String.raw`
(function managerInteractionPolish() {
  const originalJsonRequest = window.jsonRequest;
  const originalPostRepositoryAction = window.postRepositoryAction;
  let pendingButton = null;
  let activeOperations = 0;
  let progressTimer = null;
  let progressStartedAt = null;
  let progressInterval = null;
  let lastFocus = null;

  const CONFIRM_ACTIONS = {
    'install-external-controller': {
      title: 'Install standalone manager integration?',
      message: 'This creates or reuses the manager-owned issue template, labels, and workspace. It does not add a package dependency, lockfile entry, node_modules content, or paseo.json service.',
      confirm: 'Install integration', action: 'install/external', danger: false,
    },
    'migrate-embedded-controller': {
      title: 'Create migration pull request?',
      message: 'The reviewed PR removes the repository-embedded dependency and managed service launcher. Automation remains paused until merge and synchronization complete.',
      confirm: 'Create migration PR', action: 'migrate/external', danger: false,
    },
    'finalize-existing-migration': {
      title: 'Finalize the existing migration?',
      message: 'Paseo will verify the configured base branch no longer contains the embedded dependency, lockfile reference, or managed service before changing machine-local controller ownership state.',
      confirm: 'Finalize migration', action: 'migrate/adopt', danger: false,
    },
    'repair-external-controller': {
      title: 'Repair manager-owned components?',
      message: 'Repair is limited to components recorded as manager-owned. Repository file changes continue through the normal reviewed setup PR workflow.',
      confirm: 'Repair components', action: 'maintenance/repair', danger: false,
    },
    'remove-external-controller': {
      title: 'Create removal pull request?',
      message: 'This starts the reviewed removal workflow for manager-owned repository components. Claims remain paused until merge, synchronization, and cleanup complete.',
      confirm: 'Create removal PR', action: 'maintenance/remove', danger: true,
    },
  };

  function operationLabel(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'GET') return null;
    const text = pendingButton?.dataset?.busyLabel || pendingButton?.textContent?.trim();
    if (text) return text.replace(/…$/, '');
    if (String(url).includes('/config')) return 'Saving configuration';
    if (String(url).includes('/worker/')) return 'Updating worker';
    if (String(url).includes('/maintenance/')) return 'Updating maintenance state';
    if (String(url).includes('/migrate/')) return 'Updating migration';
    if (String(url).includes('/install/')) return 'Installing integration';
    return 'Applying repository action';
  }

  function ensureFeedbackUi() {
    if (!document.getElementById('manager-operation-overlay')) {
      const overlay = document.createElement('div'); overlay.id = 'manager-operation-overlay'; overlay.className = 'manager-operation-overlay'; overlay.hidden = true; overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = '<div class="manager-operation-card"><strong id="manager-operation-title">Working…</strong><p id="manager-operation-detail">The manager is applying this change.</p><div class="manager-operation-track" aria-hidden="true"></div></div>';
      document.body.append(overlay);
    }
    if (!document.getElementById('manager-toast-region')) {
      const region = document.createElement('div'); region.id = 'manager-toast-region'; region.className = 'manager-toast-region'; region.setAttribute('aria-live', 'polite'); region.setAttribute('aria-relevant', 'additions'); document.body.append(region);
    }
    if (!document.getElementById('manager-modal-scrim')) {
      const scrim = document.createElement('div'); scrim.id = 'manager-modal-scrim'; scrim.className = 'manager-modal-scrim'; scrim.hidden = true;
      scrim.innerHTML = '<section class="manager-modal" role="dialog" aria-modal="true" aria-labelledby="manager-modal-title"><h2 id="manager-modal-title"></h2><p id="manager-modal-message"></p><div id="manager-modal-input-wrap"></div><div class="manager-modal-actions"><button type="button" class="secondary" id="manager-modal-cancel">Cancel</button><button type="button" id="manager-modal-confirm">Continue</button></div></section>';
      document.body.append(scrim);
    }
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
      button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = (label || button.dataset.idleText || 'Working') + '…';
    } else {
      button.removeAttribute('aria-busy'); button.disabled = button.dataset.wasDisabled === 'true';
      if (button.dataset.idleText) button.textContent = button.dataset.idleText;
      delete button.dataset.idleText; delete button.dataset.wasDisabled;
    }
  }

  function startOperation(label, button) {
    activeOperations += 1;
    if (button) { button.dataset.wasDisabled = button.disabled ? 'true' : 'false'; setBusy(button, true, label); }
    if (activeOperations > 1) return;
    progressStartedAt = Date.now();
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      const overlay = document.getElementById('manager-operation-overlay');
      if (!overlay || activeOperations < 1) return;
      document.getElementById('manager-operation-title').textContent = label || 'Working…';
      overlay.hidden = false;
      progressInterval = setInterval(() => {
        const seconds = Math.max(1, Math.floor((Date.now() - progressStartedAt) / 1000));
        const detail = document.getElementById('manager-operation-detail');
        if (detail) detail.textContent = 'Still working · ' + seconds + 's elapsed';
      }, 1000);
    }, 1000);
  }

  function finishOperation(button) {
    if (button) setBusy(button, false);
    activeOperations = Math.max(0, activeOperations - 1);
    if (activeOperations) return;
    clearTimeout(progressTimer); clearInterval(progressInterval); progressTimer = null; progressInterval = null;
    const overlay = document.getElementById('manager-operation-overlay'); if (overlay) overlay.hidden = true;
    const detail = document.getElementById('manager-operation-detail'); if (detail) detail.textContent = 'The manager is applying this change.';
  }

  function resultSummary(result) {
    if (!result) return 'The action completed successfully.';
    if (typeof result === 'string') return result;
    const issue = result.issueNumber || result.issue || result.number;
    const text = result.message || result.summary || result.reason || result.status || result.action;
    if (issue && text) return 'Issue #' + issue + ' · ' + text;
    if (text) return String(text);
    if (issue) return 'Issue #' + issue + ' was updated.';
    return 'The action completed successfully.';
  }

  function toast(kind, title, detail) {
    ensureFeedbackUi();
    const region = document.getElementById('manager-toast-region');
    const item = document.createElement('div'); item.className = 'manager-toast ' + kind;
    const heading = document.createElement('strong'); heading.textContent = title;
    const copy = document.createElement('div'); copy.textContent = detail;
    item.append(heading, copy); region.append(item);
    setTimeout(() => item.remove(), 6500);
  }

  function modal({ title, message, confirmLabel = 'Continue', danger = false, input = false, inputValue = '' } = {}) {
    ensureFeedbackUi();
    const scrim = document.getElementById('manager-modal-scrim');
    const confirm = document.getElementById('manager-modal-confirm');
    const cancel = document.getElementById('manager-modal-cancel');
    const inputWrap = document.getElementById('manager-modal-input-wrap');
    document.getElementById('manager-modal-title').textContent = title || 'Confirm action';
    document.getElementById('manager-modal-message').textContent = message || '';
    confirm.textContent = confirmLabel; confirm.className = danger ? 'danger' : '';
    inputWrap.textContent = '';
    let field = null;
    if (input) {
      field = document.createElement('input'); field.type = 'text'; field.value = inputValue; field.setAttribute('aria-label', 'Reason'); inputWrap.append(field);
    }
    lastFocus = document.activeElement;
    scrim.hidden = false;
    const focusables = () => [...scrim.querySelectorAll('button,input')].filter((element) => !element.disabled);
    return new Promise((resolve) => {
      const close = (value) => {
        scrim.hidden = true; confirm.onclick = null; cancel.onclick = null; scrim.onkeydown = null; scrim.onclick = null;
        try { lastFocus?.focus?.(); } catch {}
        resolve(value);
      };
      cancel.onclick = () => close(input ? null : false);
      confirm.onclick = () => close(input ? String(field?.value || '').trim() : true);
      scrim.onclick = (event) => { if (event.target === scrim) close(input ? null : false); };
      scrim.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(input ? null : false); return; }
        if (event.key !== 'Tab') return;
        const items = focusables(); if (!items.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      (field || cancel).focus();
    });
  }

  async function runConfirmedButton(config, button) {
    const approved = await modal({ title: config.title, message: config.message, confirmLabel: config.confirm, danger: config.danger });
    if (!approved) return;
    pendingButton = button;
    try { await window.postRepositoryAction(config.action); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { pendingButton = null; }
  }

  function queueIssueNumber(button) {
    const row = button.closest('[data-issue-number]');
    if (row?.dataset.issueNumber) return Number(row.dataset.issueNumber);
    const drawerTitle = document.querySelector('#work-detail-drawer h2')?.textContent || '';
    const match = drawerTitle.match(/#(\d+)/); if (match) return Number(match[1]);
    const manual = Number(document.getElementById('issue-number')?.value); return Number.isInteger(manual) && manual > 0 ? manual : null;
  }

  async function runQueueDanger(button, action) {
    const issueNumber = queueIssueNumber(button);
    if (!issueNumber) { toast('error', 'Action unavailable', 'A valid issue number could not be determined.'); return; }
    const payload = { issueNumber, branchAction: document.getElementById('work-detail-branch-action')?.value || document.getElementById('branch-action')?.value || 'keep' };
    if (action === 'restart-issue') {
      const approved = await modal({ title: 'Restart issue #' + issueNumber + '?', message: 'This starts a fresh automation attempt. Use the branch choice shown with the action to decide whether the prior branch is retained.', confirmLabel: 'Restart issue', danger: true });
      if (!approved) return;
    } else {
      const reason = await modal({ title: 'Abandon issue #' + issueNumber + '?', message: 'Record why this active attempt should be abandoned. The reason is saved with the run history.', confirmLabel: 'Abandon attempt', danger: true, input: true, inputValue: 'Abandoned by user' });
      if (reason === null) return;
      if (!reason) { toast('error', 'Reason required', 'Enter a reason before abandoning the attempt.'); return; }
      payload.reason = reason;
    }
    pendingButton = button;
    try { await window.postRepositoryAction(action, payload); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { pendingButton = null; }
  }

  async function removeRepository(button) {
    const repositoryId = document.getElementById('repository-select')?.value;
    const repositoryName = document.getElementById('repository-select')?.selectedOptions?.[0]?.textContent || 'this repository';
    if (!repositoryId) return;
    const approved = await modal({ title: 'Remove ' + repositoryName + ' from this manager?', message: 'This removes only the manager registration. Repository files and machine-local repository state are not deleted.', confirmLabel: 'Remove from manager', danger: true });
    if (!approved) return;
    pendingButton = button;
    try {
      await window.jsonRequest('/api/repositories/' + encodeURIComponent(repositoryId), { method: 'DELETE' });
      localStorage.removeItem('paseo-manager-repository');
      try { currentStatus = null; } catch {}
      if (typeof loadRepositories === 'function') await loadRepositories();
      toast('success', 'Repository removed', repositoryName + ' is no longer registered with this manager.');
    } catch (error) { if (typeof showError === 'function') showError(error); toast('error', 'Removal failed', error.message || String(error)); }
    finally { pendingButton = null; }
  }

  function interceptDangerousClicks(event) {
    const button = event.target.closest?.('button');
    if (!button || button.disabled) return;
    const configured = CONFIRM_ACTIONS[button.id];
    const issueAction = button.dataset.issueAction || ((button.textContent.trim() === 'Restart' || button.textContent.trim() === 'Abandon') && (button.closest('.work-queue-item') || button.closest('#work-detail-drawer')) ? (button.textContent.trim() === 'Restart' ? 'restart-issue' : 'abandon-issue') : null);
    if (!configured && !issueAction && button.id !== 'remove-button') { pendingButton = button; return; }
    if (issueAction && !['restart-issue', 'abandon-issue'].includes(issueAction)) { pendingButton = button; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (configured) runConfirmedButton(configured, button);
    else if (button.id === 'remove-button') removeRepository(button);
    else runQueueDanger(button, issueAction);
  }

  function labelRawResult() {
    const result = document.getElementById('dispatch-result');
    const heading = result?.closest('.card')?.querySelector('h2');
    if (heading) heading.textContent = 'Technical action result (raw JSON)';
  }

  ensureFeedbackUi();
  document.addEventListener('click', interceptDangerousClicks, true);
  document.addEventListener('focusin', (event) => { if (event.target.matches?.('button')) pendingButton = event.target; });
  labelRawResult();

  if (typeof originalJsonRequest === 'function') {
    window.jsonRequest = async function managerFeedbackJsonRequest(url, options = {}) {
      const label = operationLabel(url, options);
      const button = label ? pendingButton : null;
      if (label) startOperation(label, button);
      try { return await originalJsonRequest(url, options); }
      finally { if (label) finishOperation(button); pendingButton = null; }
    };
  }

  if (typeof originalPostRepositoryAction === 'function') {
    window.postRepositoryAction = async function managerFeedbackRepositoryAction(action, payload) {
      try {
        const body = await originalPostRepositoryAction(action, payload);
        toast('success', 'Action complete', resultSummary(body?.result));
        return body;
      } catch (error) {
        toast('error', 'Action failed', error.message || String(error));
        throw error;
      }
    };
  }
})();
`;

export function enhanceManagerWithInteractionPolish(html) {
  const styled = injectIntoHead(html, `<style data-manager-interaction-style>${MANAGER_INTERACTION_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-interaction>${MANAGER_INTERACTION_SCRIPT}</script>`);
}
