import {
  getIssuesSetupPageStatus,
  recheckIssuesSetupPage,
  saveIssuesSetupPage,
} from './issues-page-service.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'issues-setup-request-failed', message: String(error?.message || error || 'Issues setup request failed.') } }, status);
}

export function issuesSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/issues')) return { handled: false };
  try {
    if (pathname === '/api/setup/issues/status' && method === 'GET') return response(getIssuesSetupPageStatus(options));
    if (pathname === '/api/setup/issues/save' && method === 'POST') return response(saveIssuesSetupPage(body, options));
    if (pathname === '/api/setup/issues/recheck' && method === 'POST') return response(recheckIssuesSetupPage(options));
    return response({ error: { code: 'issues-setup-route-unavailable', message: `Issues setup route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
