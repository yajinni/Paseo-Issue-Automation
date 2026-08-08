import { injectIntoBody } from './ui-html.mjs';

export const MANAGER_STATUS_EVENTS_SCRIPT = String.raw`
(function managerStatusEvents() {
  if (window.__paseoManagerStatusEvents) return;
  const baseRenderStatus = window.renderStatus;
  if (typeof baseRenderStatus !== 'function') return;

  const legacySubscribers = [];
  const listeners = new Set();
  let dispatching = false;
  let activeResult;

  function reportFailure(kind, error) {
    try { console.error('Manager status ' + kind + ' failed.', error); } catch {}
  }

  function dispatchManagerStatus(data) {
    if (dispatching) return activeResult;
    dispatching = true;
    try {
      activeResult = baseRenderStatus(data);
      for (const subscriber of [...legacySubscribers]) {
        try { subscriber(data); } catch (error) { reportFailure('subscriber', error); }
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

  Object.defineProperty(window, 'renderStatus', {
    configurable: true,
    enumerable: true,
    get() { return dispatchManagerStatus; },
    set(next) {
      if (typeof next === 'function' && next !== dispatchManagerStatus && !legacySubscribers.includes(next)) {
        legacySubscribers.push(next);
      }
    },
  });

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
  return injectIntoBody(html, `<script data-manager-status-events>${MANAGER_STATUS_EVENTS_SCRIPT}</script>`);
}
