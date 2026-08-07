export const SETUP_SHELL_FEEDBACK_SCRIPT = String.raw`
(function setupShellFeedback() {
  const nativeFetch = window.fetch.bind(window);
  let taskSequence = 0;
  let visibleTaskId = null;
  let elapsedTimer = null;

  function requestPath(input) {
    try {
      const value = typeof input === 'string' ? input : input?.url || '';
      return new URL(value, location.href).pathname;
    } catch {
      return '';
    }
  }

  function taskMeta(path, method) {
    if (path.includes('/paseo/')) return {
      label: method === 'GET' ? 'Checking Paseo' : 'Updating Paseo connection',
      steps: ['Paseo CLI', 'Paseo daemon', 'Authentication', 'Compatibility'],
    };
    if (path.includes('/harness/')) return {
      label: path.endsWith('/save') ? 'Saving Provider/Coding Harness selections' : 'Refreshing Provider/Coding Harness options',
      steps: ['Provider/Coding Harness', 'Coding model catalog', 'Review model catalog'],
    };
    if (path.includes('/github/account')) return {
      label: 'Updating GitHub account',
      steps: ['GitHub CLI', 'Authentication', 'Repository access'],
    };
    if (path.includes('/github/')) return {
      label: path.endsWith('/save') ? 'Saving GitHub repository selections' : 'Checking GitHub repository access',
      steps: ['GitHub CLI and account', 'Repository access', 'Base branch'],
    };
    if (path.includes('/workspace/')) return {
      label: path.endsWith('/prepare') ? 'Preparing repository workspace' : 'Checking repository workspace',
      steps: ['Checkout discovery', 'Repository registration', 'Paseo workspace', 'Isolated worktree cleanup'],
    };
    if (path.includes('/issues/')) return {
      label: path.endsWith('/save') ? 'Saving issue-processing settings' : 'Checking issue-processing setup',
      steps: ['Issue-processing settings', 'Lifecycle labels', 'Automation issue template'],
    };
    if (path.includes('/review/')) return {
      label: path.endsWith('/save') ? 'Saving review setup' : 'Checking review setup',
      steps: ['Review workflow', 'Review round limits', 'ChatGPT Profile when required'],
    };
    if (path.includes('/readiness/finish')) return {
      label: 'Finishing setup',
      steps: ['Save durable setup state', 'Apply automation start choice', 'Start selected workers'],
    };
    if (path.includes('/readiness/')) return {
      label: 'Running final readiness checks',
      steps: ['Previous setup sections', 'Setup pull request', 'Safe readiness probes'],
    };
    if (path.includes('/session/navigate')) return { label: 'Opening the next setup step', steps: ['Save setup progress'] };
    if (path.includes('/session')) return { label: 'Loading setup progress', steps: ['Setup session'] };
    return { label: 'Working on setup', steps: ['Setup request'] };
  }

  function ensureOverlay() {
    let overlay = document.getElementById('setup-operation-overlay');
    if (overlay || !document.body) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'setup-operation-overlay';
    overlay.className = 'setup-operation-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<section class="setup-operation-card" role="status" aria-live="polite" aria-atomic="false">'
      + '<div class="setup-operation-spinner" aria-hidden="true"></div>'
      + '<div class="setup-operation-main"><strong id="setup-operation-title">Working on setup</strong>'
      + '<div class="setup-operation-copy" id="setup-operation-copy">The current task is still running.</div>'
      + '<div class="setup-operation-steps" id="setup-operation-steps"></div>'
      + '<div class="setup-operation-elapsed" id="setup-operation-elapsed"></div></div>'
      + '</section>';
    document.body.append(overlay);
    return overlay;
  }

  function stepMarkup(label, state, detail = '') {
    const symbol = state === 'ok' ? '✓' : state === 'bad' ? '!' : state === 'checking' ? '↻' : '·';
    const stateLabel = state === 'ok' ? 'Verified' : state === 'bad' ? 'Needs attention' : state === 'checking' ? 'Checking' : 'Waiting';
    return '<div class="setup-operation-step setup-operation-step-' + state + '"><span>' + symbol + '</span><div><strong>'
      + label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      + '</strong><small>' + stateLabel + (detail ? ' · ' + detail.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : '') + '</small></div></div>';
  }

  function renderRunning(task) {
    const overlay = ensureOverlay();
    if (!overlay) return;
    visibleTaskId = task.id;
    overlay.hidden = false;
    document.getElementById('setup-operation-title').textContent = task.meta.label;
    document.getElementById('setup-operation-copy').textContent = 'Setup is actively working. Checks that have not returned yet are shown as waiting.';
    document.getElementById('setup-operation-steps').innerHTML = task.meta.steps.map((step, index) => stepMarkup(step, index === 0 ? 'checking' : 'waiting')).join('');
    const elapsed = document.getElementById('setup-operation-elapsed');
    const updateElapsed = () => { if (elapsed) elapsed.textContent = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000)) + 's elapsed'; };
    updateElapsed();
    clearInterval(elapsedTimer);
    elapsedTimer = setInterval(updateElapsed, 1000);
  }

  function responseCheck(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.check && typeof body.check === 'object') return body.check;
    if (body.status?.check && typeof body.status.check === 'object') return body.status.check;
    if (body.workspaceCheck && typeof body.workspaceCheck === 'object') return body.workspaceCheck;
    if (body.checkoutCheck && typeof body.checkoutCheck === 'object') return body.checkoutCheck;
    return null;
  }

  function renderFinished(task, ok, body, failureMessage = '') {
    const overlay = ensureOverlay();
    if (!overlay || visibleTaskId !== task.id) return;
    clearInterval(elapsedTimer);
    const check = responseCheck(body);
    const passed = ok && check?.ok !== false;
    const blockerMessage = check?.blockers?.[0]?.message || failureMessage || '';
    document.getElementById('setup-operation-title').textContent = passed ? task.meta.label + ' complete' : task.meta.label + ' needs attention';
    document.getElementById('setup-operation-copy').textContent = passed
      ? (check?.summary || 'The setup task completed.')
      : (blockerMessage || check?.summary || 'The setup task did not complete successfully.');
    document.getElementById('setup-operation-steps').innerHTML = task.meta.steps.map((step, index) => stepMarkup(step, passed ? 'ok' : index === task.meta.steps.length - 1 ? 'bad' : 'ok')).join('');
    document.getElementById('setup-operation-elapsed').textContent = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000)) + 's total';
    setTimeout(() => {
      if (visibleTaskId !== task.id) return;
      overlay.hidden = true;
      visibleTaskId = null;
    }, passed ? 650 : 1400);
  }

  window.fetch = async function setupAwareFetch(input, init = {}) {
    const path = requestPath(input);
    if (!path.startsWith('/api/setup/')) return nativeFetch(input, init);
    const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    const task = {
      id: ++taskSequence,
      path,
      meta: taskMeta(path, method),
      startedAt: Date.now(),
      shown: false,
      done: false,
      timer: null,
    };
    task.timer = setTimeout(() => {
      if (task.done) return;
      task.shown = true;
      renderRunning(task);
    }, 1000);

    try {
      const response = await nativeFetch(input, init);
      let body = null;
      try { body = await response.clone().json(); } catch {}
      task.done = true;
      clearTimeout(task.timer);
      if (task.shown) renderFinished(task, response.ok, body, response.ok ? '' : 'The setup request failed.');
      return response;
    } catch (error) {
      task.done = true;
      clearTimeout(task.timer);
      if (task.shown) renderFinished(task, false, null, error?.message || String(error));
      throw error;
    }
  };

  function syncUncheckedStatus() {
    const status = document.getElementById('status');
    if (!status) return;
    const title = status.querySelector('.status-title')?.textContent?.trim() || '';
    const unused = title === 'Not checked yet';
    status.hidden = unused;
    status.setAttribute('aria-hidden', unused ? 'true' : 'false');
  }

  function observeShell() {
    syncUncheckedStatus();
    const status = document.getElementById('status');
    if (status) new MutationObserver(syncUncheckedStatus).observe(status, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeShell, { once: true });
  else observeShell();
})();
`;

const SETUP_SHELL_FEEDBACK_STYLE = String.raw`
<style data-setup-shell-feedback-style>
.setup-operation-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#070a0fb8;backdrop-filter:blur(3px)}
.setup-operation-overlay[hidden]{display:none}.setup-operation-card{width:min(560px,100%);display:grid;grid-template-columns:34px minmax(0,1fr);gap:14px;border:1px solid #3b4b61;background:#131b26;border-radius:14px;padding:20px;box-shadow:0 22px 70px #0009}.setup-operation-spinner{width:28px;height:28px;border:3px solid #4b607d;border-top-color:#dbeafe;border-radius:50%;animation:setup-operation-spin .8s linear infinite}.setup-operation-main>strong{display:block;font-size:17px}.setup-operation-copy{color:#aab8c9;margin-top:5px;line-height:1.45}.setup-operation-steps{display:grid;gap:7px;margin-top:14px}.setup-operation-step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:start;padding:7px 8px;border:1px solid #2b394d;border-radius:8px;background:#0f1620}.setup-operation-step>span{display:grid;place-items:center;width:18px;height:18px;border:1px solid #526074;border-radius:50%;font-size:11px}.setup-operation-step strong,.setup-operation-step small{display:block}.setup-operation-step small{margin-top:2px;color:#8fa0b4}.setup-operation-step-ok{border-color:#2f6c48}.setup-operation-step-ok>span{background:#24633d;border-color:#2f8d55}.setup-operation-step-bad{border-color:#8c4945}.setup-operation-step-bad>span{background:#5f302d;border-color:#98514b}.setup-operation-step-checking{border-color:#365f8b}.setup-operation-step-checking>span{animation:setup-operation-spin 1s linear infinite}.setup-operation-step-waiting{opacity:.72}.setup-operation-elapsed{color:#718298;font-size:12px;margin-top:10px}@keyframes setup-operation-spin{to{transform:rotate(360deg)}}
.required-missing{border-color:#b74b4b!important;box-shadow:0 0 0 1px #b74b4b55}
</style>`;

export function enhanceSetupWizardWithShellFeedback(html) {
  const script = `<script data-setup-shell-feedback>${SETUP_SHELL_FEEDBACK_SCRIPT}</script>`;
  const payload = `${SETUP_SHELL_FEEDBACK_STYLE}${script}`;
  return String(html).includes('</head>')
    ? String(html).replace('</head>', `${payload}</head>`)
    : `${payload}${html}`;
}
