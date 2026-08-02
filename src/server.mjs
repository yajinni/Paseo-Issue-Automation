import http from 'node:http';
import { spawn } from 'node:child_process';
import { dashboardHtml } from './ui.mjs';
import { automationStatus, dispatchOnce, setClaimsEnabled, updateRuntimeAfterDispatch } from './automation.mjs';
import {
  createAutomationWorkspace,
  finishSetup,
  installRepositoryIntegration,
  removeIssueTemplate,
  removePaseoIntegration,
  setupSnapshot,
} from './install.mjs';
import { loadConfig, repositoryRoot, saveConfig } from './state.mjs';

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
  const command = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function combinedSnapshot(root) {
  const snapshot = setupSnapshot(root);
  let automation = null;
  if (snapshot.config.setupComplete && snapshot.requirements.githubAuthenticated) {
    try { automation = automationStatus(root); } catch { automation = null; }
  }
  return { ...snapshot, automation };
}

export async function startServer({ cwd = process.cwd(), open = false } = {}) {
  const root = repositoryRoot(cwd);
  let timer = null;

  const dispatch = () => {
    try {
      const result = dispatchOnce(root);
      updateRuntimeAfterDispatch(root, result);
      return result;
    } catch (error) {
      const result = { claimed: false, error: error.message };
      updateRuntimeAfterDispatch(root, result);
      throw error;
    }
  };

  const resetTimer = () => {
    if (timer) clearInterval(timer);
    const config = loadConfig(root);
    timer = setInterval(() => {
      try { dispatch(); } catch (error) { console.error(`[dispatch] ${error.message}`); }
    }, config.pollIntervalSeconds * 1000);
    timer.unref();
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(dashboardHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        json(response, 200, combinedSnapshot(root));
        return;
      }
      if (request.method !== 'POST') {
        json(response, 404, { error: 'Not found' });
        return;
      }
      const body = await readBody(request);
      if (url.pathname === '/api/install') installRepositoryIntegration(root);
      else if (url.pathname === '/api/remove/issue-template') {
        removeIssueTemplate(root);
        setClaimsEnabled(root, false);
        const current = loadConfig(root);
        saveConfig(root, { ...current, setupComplete: false });
      } else if (url.pathname === '/api/remove/paseo-integration') {
        removePaseoIntegration(root);
        setClaimsEnabled(root, false);
        const current = loadConfig(root);
        saveConfig(root, { ...current, setupComplete: false });
      } else if (url.pathname === '/api/workspace') createAutomationWorkspace(root);
      else if (url.pathname === '/api/config') {
        const current = loadConfig(root);
        saveConfig(root, { ...current, ...body, models: { ...current.models, ...(body.models || {}) } });
        resetTimer();
      } else if (url.pathname === '/api/finish') {
        finishSetup(root);
        setClaimsEnabled(root, false);
      } else if (url.pathname === '/api/resume') setClaimsEnabled(root, true);
      else if (url.pathname === '/api/pause') setClaimsEnabled(root, false);
      else if (url.pathname === '/api/run-now') dispatch();
      else {
        json(response, 404, { error: 'Not found' });
        return;
      }
      json(response, 200, combinedSnapshot(root));
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });

  const requestedPort = Number(process.env.PASEO_PORT || 4317);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Issue Coding Automation dashboard: ${url}`);
  resetTimer();
  if (open) openBrowser(url);
  return { server, root, url };
}
