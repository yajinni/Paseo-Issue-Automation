import { injectIntoBody } from './ui-html.mjs';

export const MANAGER_STATUS_EVENTS_SCRIPT = String.raw`
(function managerStatusEvents() {
  if (window.__paseoManagerStatusEvents) return;
  const baseRenderStatus = window.renderStatus;
  if (typeof baseRenderStatus !== 'function') return;

  const capturedRenderers = [];
  const listeners = new Set();
  let dispatching = false;
  let activeResult;

  function reportFailure(kind, error) {
    try { console.error('Manager status ' + kind + ' failed.', error); } catch {}
  }

  function statusMatchesSelectedRepository(data) {
    const selectedRepositoryId = document.getElementById?.('repository-select')?.value;
    const statusRepositoryId = data?.repository?.id;
    if (!selectedRepositoryId || statusRepositoryId == null || statusRepositoryId === '') return true;
    return String(statusRepositoryId) === String(selectedRepositoryId);
  }

  function dispatchManagerStatus(data) {
    if (!statusMatchesSelectedRepository(data)) return undefined;
    if (dispatching) return activeResult;
    dispatching = true;
    try {
      activeResult = baseRenderStatus(data);
      for (const renderer of [...capturedRenderers]) {
        try { renderer(data); } catch (error) { reportFailure('renderer', error); }
      }
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

  window.captureManagerStatusRenderer = function captureManagerStatusRenderer() {
    const renderer = window.renderStatus;
    if (typeof renderer !== 'function' || renderer === dispatchManagerStatus || capturedRenderers.includes(renderer)) {
      window.renderStatus = dispatchManagerStatus;
      return false;
    }
    capturedRenderers.push(renderer);
    window.renderStatus = dispatchManagerStatus;
    return true;
  };

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

export const MANAGER_STATUS_CAPTURE_SCRIPT = String.raw`
window.captureManagerStatusRenderer?.();
`;

export function enhanceManagerWithStatusEvents(html) {
  return injectIntoBody(html, `<script data-manager-status-events>${MANAGER_STATUS_EVENTS_SCRIPT}</script>`);
}

export function captureManagerStatusRenderer(html) {
  return injectIntoBody(html, `<script data-manager-status-capture>${MANAGER_STATUS_CAPTURE_SCRIPT}</script>`);
}
