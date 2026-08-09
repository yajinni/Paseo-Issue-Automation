import { injectIntoBody } from './ui-html.mjs';

export const MANAGER_CODING_WORKER_STATUS_SCRIPT = String.raw`
(function managerCodingWorkerStatus() {
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
  return injectIntoBody(html, `<script data-manager-coding-worker-status>${MANAGER_CODING_WORKER_STATUS_SCRIPT}</script>`);
}
