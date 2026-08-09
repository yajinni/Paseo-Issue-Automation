import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CODING_WORKER_STATUS_STYLE = String.raw`
.overview-metric-value-row{display:flex;align-items:center;gap:7px;min-width:0}
.overview-metric-value-row strong{min-width:0}
.overview-metric-action{display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 auto;width:25px;height:25px;min-width:25px!important;padding:0!important;border-radius:7px!important;font-size:12px!important;line-height:1!important}
.overview-metric-action.stop{background:#402128!important;border-color:#75404a!important;color:#f0c8cf!important}
.overview-metric-action.start{background:#173021!important;border-color:#356b4a!important;color:#b9e9ca!important}
.overview-health-action{background:#402f16!important;border-color:#80672c!important;color:#f1d38a!important}
.overview-stopped{border-color:#3b4757!important;background:#131a23!important}
.overview-health-dialog{width:min(620px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 48px));overflow:auto;border:1px solid #3a485c;border-radius:12px;background:#111924;color:#edf3ff;padding:0;box-shadow:0 24px 70px #000a}
.overview-health-dialog::backdrop{background:#05070ab8}
.overview-health-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:17px 18px;border-bottom:1px solid #2d394b}
.overview-health-dialog-head h2{margin:0 0 4px;font-size:18px}.overview-health-dialog-head p{margin:0;color:#9dacbf;font-size:12px;line-height:1.45}
.overview-health-dialog-close{flex:0 0 auto;padding:7px 10px!important}
.overview-health-list{display:grid;gap:10px;padding:16px 18px 18px}
.overview-health-issue{border:1px solid #67533a;border-radius:9px;background:#211a12;padding:11px 12px}
.overview-health-issue.error{border-color:#7d424b;background:#29181c}
.overview-health-issue strong{display:block;margin-bottom:4px}.overview-health-issue p{margin:0;color:#c1ccda;line-height:1.45;font-size:13px}
.overview-health-issue .muted{margin-top:6px;font-size:11px}.overview-health-issue .actions{margin-top:9px}
`;

export const MANAGER_CODING_WORKER_STATUS_SCRIPT = String.raw`
(function managerCodingWorkerStatus() {
  let latestHealthIssues = [];

  function workerLabel(data) {
    return data?.worker?.state === 'active' ? 'Active' : 'Idle';
  }

  function updatePairList(target, label, value) {
    if (!target) return;
    for (const row of target.querySelectorAll('.overview-summary-row')) {
      if (row.querySelector('span')?.textContent.trim() !== label) continue;
      const result = row.querySelector('strong');
      if (result) result.textContent = value;
    }
  }

  function renamePairListLabel(target, fromLabels, toLabel) {
    if (!target) return;
    for (const row of target.querySelectorAll('.overview-summary-row')) {
      const label = row.querySelector('span');
      if (!label || !fromLabels.includes(label.textContent.trim())) continue;
      label.textContent = toLabel;
    }
  }

  function metricValueRow(metric) {
    if (!metric) return null;
    let row = metric.querySelector('.overview-metric-value-row');
    if (row) return row;
    const strong = metric.querySelector('strong') || document.createElement('strong');
    row = document.createElement('div');
    row.className = 'overview-metric-value-row';
    if (strong.parentElement === metric) strong.remove();
    row.append(strong);
    metric.append(row);
    return row;
  }

  function metricAction(metric, className) {
    const row = metricValueRow(metric);
    if (!row) return null;
    let button = row.querySelector('.overview-metric-action');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'repository-action secondary overview-metric-action';
      row.append(button);
    }
    button.className = 'repository-action secondary overview-metric-action ' + className;
    return button;
  }

  async function runRepositoryAction(action) {
    if (typeof window.postRepositoryAction !== 'function') return;
    await window.postRepositoryAction(action);
  }

  function setToggleMetric(id, { enabled, label, startAction, stopAction, unavailable = false }) {
    const metric = document.getElementById(id);
    if (!metric) return;
    const title = metric.querySelector('span');
    if (title) title.textContent = label;
    const row = metricValueRow(metric);
    const value = row?.querySelector('strong');
    if (value) value.textContent = enabled ? 'Enabled' : 'Stopped';
    metric.className = 'overview-metric ' + (enabled ? 'overview-ready' : 'overview-stopped');
    const action = enabled ? stopAction : startAction;
    const verb = enabled ? 'Stop' : 'Start';
    const button = metricAction(metric, enabled ? 'stop' : 'start');
    if (!button) return;
    button.textContent = enabled ? '■' : '▶';
    button.setAttribute('aria-label', verb + ' ' + label);
    button.title = unavailable ? label + ' is currently unavailable' : verb + ' ' + label;
    button.disabled = unavailable || !document.getElementById('repository-select')?.value;
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      runRepositoryAction(action).catch((error) => {
        if (typeof window.showError === 'function') window.showError(error);
        else console.error(error);
      });
    };
  }

  function issueKey(issue) {
    return issue?.code || [issue?.title, issue?.message].filter(Boolean).join('|');
  }

  function addHealthIssue(result, seen, issue) {
    if (!issue) return;
    const key = issueKey(issue);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(issue);
  }

  function repositoryHealthIssues(data) {
    const result = [];
    const seen = new Set();
    const reviewEnabled = data?.prReviews?.available !== false && data?.prReviews?.queuePaused !== true;
    const blockers = Array.isArray(data?.blockers) ? data.blockers : null;

    if (blockers === null) {
      addHealthIssue(result, seen, {
        code: 'health-status-unavailable',
        severity: 'error',
        title: 'Repository health is unavailable',
        message: 'Paseo could not confirm the repository blocker and setup state.',
      });
    } else {
      for (const blocker of blockers) {
        if (blocker?.code === 'claims-paused') continue;
        if (blocker?.code === 'review-worker-stopped' && !reviewEnabled) continue;
        const severity = blocker?.severity || 'info';
        if (severity === 'error' || severity === 'warning' || blocker?.code === 'review-worker-stopped') {
          addHealthIssue(result, seen, blocker);
        }
      }
    }

    if (data?.setup?.complete !== true && !result.some((item) => item?.scope === 'setup' || String(item?.code || '').includes('setup'))) {
      addHealthIssue(result, seen, {
        code: 'setup-incomplete-fallback',
        severity: 'error',
        title: 'Repository setup is incomplete',
        message: 'One or more required setup checks still need attention before Paseo can reliably process issues.',
      });
    }

    if (data?.setup?.complete === true && data?.worker?.running === false) {
      addHealthIssue(result, seen, {
        code: 'coding-worker-unavailable',
        severity: 'error',
        title: 'Coding worker is unavailable',
        message: 'The automatic coding worker is not available for this configured repository.',
      });
    }

    if (data?.worker?.lastError) {
      addHealthIssue(result, seen, {
        code: 'coding-worker-error-fallback',
        severity: 'error',
        title: 'Coding worker reported an error',
        message: String(data.worker.lastError),
      });
    }
    if (data?.worker?.capacityError) {
      addHealthIssue(result, seen, {
        code: 'coding-capacity-error-fallback',
        severity: 'warning',
        title: 'Coding capacity cannot be confirmed',
        message: String(data.worker.capacityError),
      });
    }

    if (data?.prReviews?.available === false) {
      addHealthIssue(result, seen, {
        code: 'pr-review-state-unavailable',
        severity: 'warning',
        title: 'PR review state is unavailable',
        message: data.prReviews.error || 'Paseo could not read the repository PR review queue state.',
      });
    }
    const reviewError = data?.reviewWorker?.lastReviewError || data?.reviewWorker?.lastReconciliationError || data?.prReviews?.error;
    if (reviewError) {
      addHealthIssue(result, seen, {
        code: 'pr-review-error-fallback',
        severity: 'warning',
        title: 'PR reviews reported an error',
        message: String(reviewError),
      });
    }

    return result;
  }

  function issueDetails(details) {
    if (!details) return '';
    const values = [];
    if (Array.isArray(details.files) && details.files.length) values.push('Files: ' + details.files.join(', '));
    if (details.syncError) values.push('Sync error: ' + details.syncError);
    if (details.error) values.push('Error: ' + details.error);
    if (details.reason) values.push('Reason: ' + details.reason);
    return values.join(' · ');
  }

  function healthActionElement(action) {
    if (!action) return null;
    if (action.kind === 'link') {
      const anchor = document.createElement('a');
      anchor.href = action.url;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      anchor.textContent = action.label;
      return anchor;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'repository-action secondary';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      if (action.kind === 'button') {
        document.getElementById(action.targetId)?.click();
        return;
      }
      if (action.kind === 'post') {
        runRepositoryAction(action.endpoint).catch((error) => {
          if (typeof window.showError === 'function') window.showError(error);
          else console.error(error);
        });
      }
    });
    return button;
  }

  function ensureHealthDialog() {
    let dialog = document.getElementById('overview-health-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'overview-health-dialog';
    dialog.className = 'overview-health-dialog';
    dialog.setAttribute('aria-labelledby', 'overview-health-dialog-title');
    dialog.innerHTML = '<div class="overview-health-dialog-head"><div><h2 id="overview-health-dialog-title">Health issues</h2><p>Setup blockers, worker errors, and other conditions that can prevent reliable automation.</p></div><button type="button" class="secondary overview-health-dialog-close" aria-label="Close health issues">Close</button></div><div class="overview-health-list" id="overview-health-list"></div>';
    dialog.querySelector('.overview-health-dialog-close')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function renderHealthDialog(issues) {
    const dialog = ensureHealthDialog();
    const target = dialog.querySelector('#overview-health-list');
    if (!target) return;
    target.textContent = '';
    for (const issue of issues) {
      const card = document.createElement('article');
      card.className = 'overview-health-issue ' + (issue.severity === 'error' ? 'error' : 'warning');
      const title = document.createElement('strong');
      title.textContent = issue.title || issue.code || 'Issue detected';
      const message = document.createElement('p');
      message.textContent = issue.message || 'Paseo reported a repository health issue.';
      card.append(title, message);
      const details = issueDetails(issue.details);
      if (details) {
        const detail = document.createElement('div');
        detail.className = 'muted';
        detail.textContent = details;
        card.append(detail);
      }
      const action = healthActionElement(issue.action);
      if (action) {
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(action);
        card.append(actions);
      }
      target.append(card);
    }
  }

  function setHealthMetric(data) {
    const metric = document.getElementById('overview-issue-processing');
    if (!metric) return;
    const title = metric.querySelector('span');
    if (title) title.textContent = 'Health';
    latestHealthIssues = repositoryHealthIssues(data);
    renderHealthDialog(latestHealthIssues);
    const healthy = latestHealthIssues.length === 0;
    const row = metricValueRow(metric);
    const value = row?.querySelector('strong');
    if (value) value.textContent = healthy ? 'Good' : 'Issues Detected';
    metric.className = 'overview-metric ' + (healthy ? 'overview-ready' : 'overview-blocked');
    let button = metricAction(metric, 'overview-health-action');
    if (!button) return;
    button.textContent = '⚠';
    button.setAttribute('aria-label', 'Show health issues');
    button.title = 'Show health issues';
    button.hidden = healthy;
    button.disabled = healthy;
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const dialog = ensureHealthDialog();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };

    const attention = document.getElementById('overview-attention');
    if (attention) {
      const count = attention.querySelector('strong');
      if (count) count.textContent = String(latestHealthIssues.length);
      attention.className = 'overview-metric ' + (latestHealthIssues.length ? 'overview-attention' : 'overview-ready');
    }

    const statusTitle = document.getElementById('overview-status-title');
    const statusMessage = document.getElementById('overview-status-message');
    if (statusTitle) statusTitle.textContent = healthy ? 'Repository health is good' : 'Repository needs attention';
    if (statusMessage) statusMessage.textContent = healthy
      ? 'No setup blockers or automation errors are currently reported.'
      : latestHealthIssues[0]?.message || 'Paseo detected a repository health issue.';

    const primary = document.getElementById('overview-primary-action');
    if (primary) {
      primary.textContent = '';
      const action = healthActionElement(latestHealthIssues[0]?.action);
      if (action) primary.append(action);
    }
  }

  function updateIssueProcessing(data) {
    const target = document.getElementById('manager-unified-issue-processing-facts');
    if (target) {
      const terms = [...target.querySelectorAll('dt')];
      const stateTerm = terms.find((term) => term.textContent.trim() === 'State');
      const stateValue = stateTerm?.nextElementSibling?.querySelector('.manager-issue-processing-state');
      if (stateValue) {
        const running = data?.automation?.claimsEnabled === true;
        stateValue.textContent = running ? 'Running' : 'Paused';
        stateValue.className = 'manager-issue-processing-state ' + (running ? 'running' : 'paused');
      }
    }
    const claimsEnabled = data?.automation?.claimsEnabled === true;
    const start = document.getElementById('manager-start-issue-processing');
    const pause = document.getElementById('manager-pause-issue-processing');
    if (start) start.disabled = claimsEnabled;
    if (pause) pause.disabled = !claimsEnabled;
  }

  function renderOverviewControls(data) {
    const claimsEnabled = data?.automation?.claimsEnabled === true;
    const prReviewsAvailable = data?.prReviews?.available !== false;
    const prReviewsEnabled = prReviewsAvailable && data?.prReviews?.queuePaused !== true;

    setHealthMetric(data);
    setToggleMetric('overview-claims', {
      enabled: claimsEnabled,
      label: 'Issue Claiming',
      startAction: 'resume',
      stopAction: 'pause',
    });
    setToggleMetric('overview-review-worker', {
      enabled: prReviewsEnabled,
      label: 'PR Reviews',
      startAction: 'pr-review/resume',
      stopAction: 'pr-review/pause',
      unavailable: !prReviewsAvailable,
    });

    const currentWork = document.getElementById('overview-current-work');
    renamePairListLabel(currentWork, ['Claims', 'Issue processing'], 'Issue Claiming');
    updatePairList(currentWork, 'Issue Claiming', claimsEnabled ? 'Enabled' : 'Stopped');
  }

  function render(data) {
    if (!data) return;
    const label = workerLabel(data);
    updatePairList(document.getElementById('overview-recent-activity'), 'Coding worker', label);
    const metric = document.getElementById('overview-coding-worker');
    if (metric) {
      const value = metric.querySelector('strong');
      if (value) value.textContent = label;
      metric.className = 'overview-metric ' + (label === 'Active' ? 'overview-active' : 'overview-ready');
    }
    document.querySelectorAll('[data-action="worker/start"],[data-action="worker/stop"],[data-action="worker/restart"]').forEach((button) => button.remove());
    updateIssueProcessing(data);
    renderOverviewControls(data);
  }

  if (typeof window.addManagerStatusListener === 'function') window.addManagerStatusListener(render);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
    }, { once: true });
  } else {
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
  }
})();
`;

export function enhanceManagerWithCodingWorkerStatus(html) {
  const styled = injectIntoHead(html, `<style data-manager-coding-worker-status-style>${MANAGER_CODING_WORKER_STATUS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-coding-worker-status>${MANAGER_CODING_WORKER_STATUS_SCRIPT}</script>`);
}
