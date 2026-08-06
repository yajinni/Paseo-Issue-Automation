import http from 'node:http';
import { spawn } from 'node:child_process';
import { managerApiRequest } from './manager-api.mjs';
import { managerHtml } from './manager-worker-ui.mjs';
import { createManagerWorkerPool } from './manager-workers.mjs';

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

export async function startManagerServer({
  open = false,
  port = Number(process.env.PASEO_MANAGER_PORT || 4318),
  rootDir,
  workerManager = createManagerWorkerPool(),
} = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(managerHtml());
        return;
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method)
        ? await readBody(request)
        : {};
      const result = managerApiRequest({
        method: request.method,
        pathname: url.pathname,
        body,
      }, { rootDir, workerManager });
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
  server.on('close', () => workerManager.close());
  if (open) openBrowser(url);
  return { server, url, workerManager };
}
