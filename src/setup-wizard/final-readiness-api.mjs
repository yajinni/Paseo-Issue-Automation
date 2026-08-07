import {
  buildFinalReadinessSummary,
  finishSetup,
  runFinalReadinessChecks,
} from './final-readiness-service.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'final-readiness-request-failed', message: String(error?.message || error || 'Final readiness request failed.') } }, status);
}

export async function finalReadinessApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/readiness')) return { handled: false };
  try {
    if (pathname === '/api/setup/readiness/summary' && method === 'GET') return response(buildFinalReadinessSummary(options));
    if (pathname === '/api/setup/readiness/recheck' && method === 'POST') return response(await runFinalReadinessChecks(options));
    if (pathname === '/api/setup/readiness/finish' && method === 'POST') return response(await finishSetup({ startAutomation: body.startAutomation === true }, options));
    return response({ error: { code: 'final-readiness-route-unavailable', message: `Final readiness route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
