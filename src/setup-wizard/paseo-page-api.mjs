import {
  connectPaseoSetupPage,
  forgetPaseoSetupCredential,
  recheckPaseoSetupPage,
} from './paseo-page-service.mjs';

function response(body, status = 200) {
  return { handled: true, status, body };
}

function errorResponse(error, status = 400) {
  return response({
    error: {
      code: 'paseo-setup-request-failed',
      message: String(error?.message || error || 'Paseo setup request failed.'),
    },
  }, status);
}

export async function paseoSetupPageApiRequest({ method, pathname, body = {} }, options = {}) {
  if (!pathname.startsWith('/api/setup/paseo')) return { handled: false };
  try {
    if (pathname === '/api/setup/paseo/status' && method === 'GET') {
      return response(await recheckPaseoSetupPage(options));
    }
    if (pathname === '/api/setup/paseo/connect' && method === 'POST') {
      return response(await connectPaseoSetupPage({
        ...options,
        host: body.host,
        password: body.password,
        remember: body.remember !== false,
      }));
    }
    if (pathname === '/api/setup/paseo/recheck' && method === 'POST') {
      return response(await recheckPaseoSetupPage(options));
    }
    if (pathname === '/api/setup/paseo/forget' && method === 'POST') {
      return response(await forgetPaseoSetupCredential(options));
    }
    return response({
      error: {
        code: method === 'GET' ? 'paseo-setup-route-not-found' : 'paseo-setup-method-not-allowed',
        message: `Paseo setup route ${pathname} is not available for ${method}.`,
      },
    }, method === 'GET' ? 404 : 405);
  } catch (error) {
    return errorResponse(error);
  }
}
