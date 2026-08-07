import {
  cancelSetupSession,
  completeSetupSession,
  loadSetupSessionStore,
  navigateSetupSession,
  recordSetupPageCheck,
  resetSetupSessionStore,
  saveSetupPage,
  SETUP_PAGE_IDS,
  startSetupSession,
} from './store.mjs';

function pageId(body = {}) {
  const value = String(body.pageId || '').trim();
  if (!SETUP_PAGE_IDS.includes(value)) throw new Error('A valid setup pageId is required.');
  return value;
}

function response(body, status = 200) {
  return { handled: true, status, body };
}

function errorResponse(error, status = 400) {
  return response({
    error: {
      code: 'setup-request-invalid',
      message: String(error?.message || error || 'Setup request failed.'),
    },
  }, status);
}

export function setupWizardApiRequest({ method, pathname, body = {} }, options = {}) {
  try {
    if (pathname === '/api/setup/session' && method === 'GET') {
      return response(loadSetupSessionStore(options));
    }
    if (pathname === '/api/setup/session/start' && method === 'POST') {
      return response({ session: startSetupSession({ ...options, restart: body.restart === true }) });
    }
    if (pathname === '/api/setup/session/reset' && method === 'POST') {
      return response(resetSetupSessionStore(options));
    }
    if (pathname === '/api/setup/session/cancel' && method === 'POST') {
      return response({ session: cancelSetupSession(options) });
    }
    if (pathname === '/api/setup/session/complete' && method === 'POST') {
      return response({ session: completeSetupSession(options) });
    }
    if (pathname === '/api/setup/session/page' && method === 'POST') {
      const selectedPage = pageId(body);
      return response({ session: saveSetupPage(selectedPage, body, options) });
    }
    if (pathname === '/api/setup/session/recheck' && method === 'POST') {
      const selectedPage = pageId(body);
      const checker = options.recheckSetupPage;
      if (typeof checker !== 'function') {
        return errorResponse(new Error('Setup recheck is not available for this page yet.'), 501);
      }
      const store = loadSetupSessionStore(options);
      if (!store.activeSession) return errorResponse(new Error('No active setup session exists.'), 409);
      const result = checker({
        pageId: selectedPage,
        session: store.activeSession,
        selections: store.activeSession.pages[selectedPage]?.selections || {},
      });
      if (!result || typeof result !== 'object') throw new Error('Setup recheck must return a structured result.');
      const session = recordSetupPageCheck(selectedPage, result, options);
      return response({ session, check: session.pages[selectedPage].lastCheck });
    }
    if (pathname === '/api/setup/session/navigate' && method === 'POST') {
      return response({ session: navigateSetupSession(String(body.direction || ''), options) });
    }
    if (pathname.startsWith('/api/setup/session/')) {
      return response({
        error: {
          code: method === 'GET' ? 'setup-route-not-found' : 'setup-method-not-allowed',
          message: `Setup route ${pathname} is not available for ${method}.`,
        },
      }, method === 'GET' ? 404 : 405);
    }
    return { handled: false };
  } catch (error) {
    return errorResponse(error);
  }
}
