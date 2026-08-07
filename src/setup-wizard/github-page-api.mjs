import {
  getGitHubSetupPageStatus,
  recheckGitHubSetupPage,
  runGitHubSetupAccountAction,
  saveGitHubSetupPage,
} from './github-page-service.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'github-setup-request-failed', message: String(error?.message || error || 'GitHub setup request failed.') } }, status);
}

export function githubSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/github')) return { handled: false };
  try {
    if (pathname === '/api/setup/github/status' && method === 'GET') return response(getGitHubSetupPageStatus(options));
    if (pathname === '/api/setup/github/save' && method === 'POST') return response(saveGitHubSetupPage(body, options));
    if (pathname === '/api/setup/github/recheck' && method === 'POST') return response(recheckGitHubSetupPage(options));
    if (pathname === '/api/setup/github/account' && method === 'POST') return response(runGitHubSetupAccountAction(body, options));
    return response({ error: { code: 'github-setup-route-unavailable', message: `GitHub setup route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
