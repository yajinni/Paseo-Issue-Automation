import {
  getReviewSetupPageStatus,
  installChatGptChromium,
  openChatGptProfile,
  recheckReviewSetupPage,
  saveReviewChat,
  saveReviewSetupPage,
} from './review-page-service.mjs';

function response(body, status = 200) { return { handled: true, status, body }; }
function failure(error, status = 400) {
  return response({ error: { code: 'review-setup-request-failed', message: String(error?.message || error || 'Review setup request failed.') } }, status);
}

export async function reviewSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/review')) return { handled: false };
  try {
    if (pathname === '/api/setup/review/status' && method === 'GET') return response(getReviewSetupPageStatus(options));
    if (pathname === '/api/setup/review/save' && method === 'POST') return response(saveReviewSetupPage(body, options));
    if (pathname === '/api/setup/review/chat' && method === 'POST') return response(await saveReviewChat(body, options));
    if (pathname === '/api/setup/review/profile/open' && method === 'POST') return response(await openChatGptProfile(options));
    if (pathname === '/api/setup/review/chromium/install' && method === 'POST') return response(installChatGptChromium(options));
    if (pathname === '/api/setup/review/recheck' && method === 'POST') return response(await recheckReviewSetupPage(options));
    return response({ error: { code: 'review-setup-route-unavailable', message: `Review setup route ${pathname} is not available for ${method}.` } }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return failure(error);
  }
}
