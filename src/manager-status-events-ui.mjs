import { injectIntoBody } from './ui-html.mjs';
import { enhanceManagerWithWeeklyLogs } from './manager-weekly-logs-ui.mjs';

export const MANAGER_STATUS_EVENTS_SCRIPT = String.raw`
(function managerStatusEvents() {
  if (window.__paseoManagerStatusEvents) return;
  const baseRenderStatus = window.renderStatus;
  if (typeof baseRenderStatus !== 'function') return;

  const listeners = new Set();
  let dispatching = false;
  let activeResult;
  let lastAcceptedStatus = null;

  function reportFailure(kind, error) {
    try { console.error('Manager status ' + kind + ' failed.', error); } catch {}
  }

  function selectedRepositoryId() {
    return document.getElementById?.('repository-select')?.value || null;
  }

  function statusMatchesSelectedRepository(data) {
    const selectedId = selectedRepositoryId();
    const statusRepositoryId = data?.repository?.id;
    if (!selectedId || statusRepositoryId == null || statusRepositoryId === '') return true;
    return String(statusRepositoryId) === String(selectedId);
  }

  function clearStaleActionResult() {
    const result = document.getElementById?.('dispatch-result');
    if (result) result.textContent = 'Waiting for the selected repository status.';
  }

  function scopeCrossRepositoryActionFeedback(body) {
    if (!body || typeof body !== 'object') return;
    const message = 'Action completed for the previously selected repository after you switched repositories.';
    if (body.result && typeof body.result === 'object' && !Array.isArray(body.result)) {
      body.result = { ...body.result, message };
    } else {
      body.result = { message };
    }
  }

  function dispatchManagerStatus(data) {
    if (!statusMatchesSelectedRepository(data)) return undefined;
    if (dispatching) return activeResult;
    dispatching = true;
    try {
      activeResult = baseRenderStatus(data);
      lastAcceptedStatus = data;
      for (const listener of [...listeners]) {
        try { listener(data); } catch (error) { reportFailure('listener', error); }
      }
      try {
        document.dispatchEvent(new CustomEvent('paseo:manager-status', { detail: data }));
      } catch (error) { reportFailure('event', error); }
      return activeResult;
    } finally {
      dispatching = false;
      activeResult = undefined;
    }
  }

  window.renderStatus = dispatchManagerStatus;

  const basePostRepositoryAction = window.postRepositoryAction;
  if (typeof basePostRepositoryAction === 'function') {
    window.postRepositoryAction = async function managerRepositoryScopedPostAction(...args) {
      const actionRepositoryId = selectedRepositoryId();
      const body = await basePostRepositoryAction(...args);
      const currentRepositoryId = selectedRepositoryId();
      if (actionRepositoryId && currentRepositoryId && String(actionRepositoryId) !== String(currentRepositoryId)) {
        scopeCrossRepositoryActionFeedback(body);
        const acceptedRepositoryId = lastAcceptedStatus?.repository?.id;
        if (acceptedRepositoryId != null && String(acceptedRepositoryId) === String(currentRepositoryId)) {
          dispatchManagerStatus(lastAcceptedStatus);
        } else {
          clearStaleActionResult();
        }
      }
      return body;
    };
  }

  window.addManagerStatusListener = function addManagerStatusListener(listener) {
    if (typeof listener !== 'function') throw new TypeError('Manager status listener must be a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function announceUiReady() {
    queueMicrotask(() => {
      try { document.dispatchEvent(new CustomEvent('paseo:manager-ui-ready')); }
      catch (error) { reportFailure('ready event', error); }
    });
  }

  window.__paseoManagerStatusEvents = true;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceUiReady, { once: true });
  else announceUiReady();
})();
`;

export function enhanceManagerWithStatusEvents(html) {
  const withStatusEvents = injectIntoBody(html, `<script data-manager-status-events>${MANAGER_STATUS_EVENTS_SCRIPT}</script>`);
  return enhanceManagerWithWeeklyLogs(withStatusEvents);
}
