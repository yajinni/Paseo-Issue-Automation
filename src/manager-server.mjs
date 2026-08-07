import http from 'node:http';
import { spawn } from 'node:child_process';
import { managerApiRequest } from './manager-api.mjs';
import { managerHtml } from './manager-maintenance-ui.mjs';
import { createManagerReviewWorkerPool } from './manager-review-workers.mjs';
import { createManagerWorkerPool } from './manager-workers.mjs';
import { listRepositories } from './repository-registry.mjs';
import { loadConfig } from './state.mjs';
import { harnessSetupPageApiRequest } from './setup-wizard/harness-page-api.mjs';
import { createPaseoCredentialStore } from './setup-wizard/paseo-credentials.mjs';
import { paseoSetupPageApiRequest } from './setup-wizard/paseo-page-api.mjs';
import { setupPageIdFromPath, setupWizardHtml } from './setup-wizard/ui.mjs';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function managerHasConfiguredRepository({ rootDir } = {}) {
  const repositories = listRepositories({ rootDir });
  return repositories.some((repository) => {
    try { return loadConfig(repository.path).setupComplete === true; }
    catch { return false; }
  });
}

function managerDashboardHtml() {
  const html = managerHtml();
  const setupLink = '<a href="/setup" data-manager-setup-link style="position:fixed;right:18px;bottom:18px;z-index:50;padding:10px 13px;border-radius:10px;background:#243044;color:#fff;text-decoration:none;border:1px solid #43526a;font:600 13px system-ui">Add repository via setup</a>';
  return html.includes('</body>') ? html.replace('</body>', `${setupLink}</body>`) : `${html}${setupLink}`;
}

export async function startManagerServer({
  open = false,
  port = Number(process.env.PASEO_MANAGER_PORT || 4318),
  rootDir,
  workerManager = null,
  reviewWorkerManager = null,
  paseoCredentialStore = null,
  paseoSetupOptions = {},
  harnessSetupOptions = {},
} = {}) {
  const workers = workerManager || createManagerWorkerPool({ managerConfigOptions: { rootDir } });
  const reviewWorkers = reviewWorkerManager || createManagerReviewWorkerPool();
  const credentials = paseoCredentialStore || createPaseoCredentialStore();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        if (!managerHasConfiguredRepository({ rootDir })) {
          response.writeHead(302, { location: '/setup' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(managerDashboardHtml());
        return;
      }
      if (request.method === 'GET' && (url.pathname === '/setup' || url.pathname.startsWith('/setup/'))) {
        const requestedPage = setupPageIdFromPath(url.pathname);
        if (requestedPage === undefined) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Unknown setup page.');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(setupWizardHtml({ requestedPage }));
        return;
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method)
        ? await readBody(request)
        : {};

      const pageApiOptions = {
        rootDir,
        credentialStore: credentials,
      };
      const paseoSetup = await paseoSetupPageApiRequest({
        method: request.method,
        pathname: url.pathname,
        body,
      }, {
        ...pageApiOptions,
        ...paseoSetupOptions,
      });
      if (paseoSetup.handled) {
        json(response, paseoSetup.status, paseoSetup.body);
        return;
      }

      const harnessSetup = await harnessSetupPageApiRequest({
        method: request.method,
        pathname: url.pathname,
        body,
      }, {
        ...pageApiOptions,
        ...harnessSetupOptions,
      });
      if (harnessSetup.handled) {
        json(response, harnessSetup.status, harnessSetup.body);
        return;
      }

      const result = managerApiRequest({
        method: request.method,
        pathname: url.pathname,
        body,
      }, { rootDir, workerManager: workers, reviewWorkerManager: reviewWorkers });
      if (!result.handled) {
        json(response, 404, { error: 'Not found' });
        return;
      }
      json(response, result.status, result.body);
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Paseo repository manager: ${url}`);
  server.on('close', () => {
    workers.close();
    reviewWorkers.close();
  });
  if (open) openBrowser(url);
  return { server, url, workerManager: workers, reviewWorkerManager: reviewWorkers, paseoCredentialStore: credentials };
}
