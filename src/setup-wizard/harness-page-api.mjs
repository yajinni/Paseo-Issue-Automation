import {
  getHarnessSetupPageStatus,
  recheckHarnessSetupPage,
  saveHarnessSetupPage,
} from './harness-page-service.mjs';

function response(body, status = 200) {
  return { handled: true, status, body };
}

function errorResponse(error, status = 400) {
  return response({
    error: {
      code: 'harness-setup-request-failed',
      message: String(error?.message || error || 'Harness setup request failed.'),
    },
  }, status);
}

export async function harnessSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/harness')) return { handled: false };
  try {
    if (pathname === '/api/setup/harness/status' && method === 'GET') {
      return response(await getHarnessSetupPageStatus(options));
    }
    if (pathname === '/api/setup/harness/save' && method === 'POST') {
      return response(await saveHarnessSetupPage(body, options));
    }
    if (pathname === '/api/setup/harness/recheck' && method === 'POST') {
      return response(await recheckHarnessSetupPage(options));
    }
    return response({
      error: {
        code: method === 'GET' ? 'harness-setup-route-not-found' : 'harness-setup-method-not-allowed',
        message: `Harness setup route ${pathname} is not available for ${method}.`,
      },
    }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return errorResponse(error);
  }
}
