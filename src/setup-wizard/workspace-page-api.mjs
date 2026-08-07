import {
  getWorkspaceSetupPageStatus,
  prepareWorkspaceSetupPage,
  recheckWorkspaceSetupPage,
} from './workspace-page-service.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'workspace-setup-request-failed', message: String(error?.message || error || 'Workspace setup request failed.') } }, status);
}

export async function workspaceSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/workspace')) return { handled: false };
  try {
    if (pathname === '/api/setup/workspace/status' && method === 'GET') return response(getWorkspaceSetupPageStatus(options));
    if (pathname === '/api/setup/workspace/prepare' && method === 'POST') return response(await prepareWorkspaceSetupPage(body, options));
    if (pathname === '/api/setup/workspace/recheck' && method === 'POST') return response(await recheckWorkspaceSetupPage(options));
    return response({ error: { code: 'workspace-setup-route-unavailable', message: `Workspace setup route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
