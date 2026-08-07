import http from 'node:http';
import { spawn } from 'node:child_process';
import { managerApiRequest } from './manager-api.mjs';
import { enhanceManagerWithAutomationReviews } from './manager-automation-reviews-ui.mjs';
import { enhanceManagerWithConfigIntegrationMaintenance } from './manager-config-integration-maintenance-ui.mjs';
import { enhanceManagerWithConfigurationTabs } from './manager-configuration-tabs-ui.mjs';
import { enhanceManagerWithInteractionPolish } from './manager-interaction-ui.mjs';
import { enhanceManagerWithIssueProcessingFlow } from './manager-issue-processing-flow-ui.mjs';
import { enhanceManagerWithIssuesPrReviews } from './manager-issues-pr-reviews-ui.mjs';
import { managerHtml } from './manager-maintenance-ui.mjs';
import { enhanceManagerWithNavigation } from './manager-navigation-ui.mjs';
import { enhanceManagerWithUiFoundation, enhanceSetupWithSharedUiTheme } from './manager-ui-foundation.mjs';
import { enhanceManagerWithWorkQueue } from './manager-work-queue-ui.mjs';
import { createManagerReviewWorkerPool } from './manager-review-workers.mjs';
import { createManagerWorkerPool } from './manager-workers.mjs';
import { listRepositories } from './repository-registry.mjs';
import { loadConfig } from './state.mjs';
import { finalReadinessApiRequest } from './setup-wizard/final-readiness-api.mjs';
import { enhanceSetupWizardWithFinalReadiness } from './setup-wizard/final-readiness-ui.mjs';
import { githubSetupPageApiRequest } from './setup-wizard/github-page-api.mjs';
import { enhanceSetupWizardWithGitHubPage } from './setup-wizard/github-page-ui.mjs';
import { harnessSetupPageApiRequest } from './setup-wizard/harness-page-api.mjs';
import { enhanceSetupWizardWithHarnessPage } from './setup-wizard/harness-page-ui.mjs';
import { issuesSetupPageApiRequest } from './setup-wizard/issues-page-api.mjs';
import { enhanceSetupWizardWithIssuesPage } from './setup-wizard/issues-page-ui.mjs';
import { createPaseoCredentialStore } from './setup-wizard/paseo-credentials.mjs';
import { paseoSetupPageApiRequest } from './setup-wizard/paseo-page-api.mjs';
import { enhanceSetupWizardWithRepositoryPaseo } from './setup-wizard/repository-paseo-ui.mjs';
import { enhanceSetupWizardWithRequiredState } from './setup-wizard/required-state-ui.mjs';
import { reviewSetupPageApiRequest } from './setup-wizard/review-page-api.mjs';
import { enhanceSetupWizardWithReviewPage } from './setup-wizard/review-page-ui.mjs';
import { enhanceSetupWizardWithShellFeedback } from './setup-wizard/shell-feedback-ui.mjs';
import { enhanceSetupWizardWithSimplifiedFlow } from './setup-wizard/simplified-flow-ui.mjs';
import { setupPageIdFromPath, setupWizardHtml } from './setup-wizard/ui.mjs';
import { workspaceSetupPageApiRequest } from './setup-wizard/workspace-page-api.mjs';
import { enhanceSetupWizardWithWorkspacePage } from './setup-wizard/workspace-page-ui.mjs';

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
  const setupLink = '<a href="/setup" data-manager-setup-link class="manager-setup-link">Add repository via setup</a>';
  const manualForm = `  <form class="register" id="register-form">
    <input id="repository-path" required placeholder="C:\\path\\to\\repository or /path/to/repository" aria-label="Repository path">
    <button type="submit">Register repository</button>
  </form>`;
  const advancedRegistration = `  <section class="card manager-manual-registration" data-manager-manual-registration>
    <details>
      <summary>Advanced manual registration</summary>
      <p class="muted">Compatibility and recovery only. Manual registration adds an existing checkout to the manager but does not run the setup walkthrough, verify GitHub or Paseo, create the workspace, install managed repository components, or mark setup complete.</p>
${manualForm}
    </details>
  </section>`;
  let html = managerHtml()
    .replace(
      '</style>',
      `.manager-setup-link{display:inline-flex;align-items:center;border-radius:8px;padding:9px 13px;background:#2869d8;color:#fff;text-decoration:none;font-weight:600}.manager-setup-link:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}.manager-manual-registration{margin-top:16px}.manager-manual-registration summary{cursor:pointer;font-weight:600;color:#dce8fb}.manager-manual-registration .register{margin-top:12px}\n</style>`,
    )
    .replace(
      '<button class="secondary" id="refresh-button">Refresh</button>',
      `<button class="secondary" id="refresh-button">Refresh</button>\n      ${setupLink}`,
    )
    .replace(manualForm, advancedRegistration);
  if (!html.includes('data-manager-setup-link')) {
    html = html.includes('</body>') ? html.replace('</body>', `${setupLink}</body>`) : `${html}${setupLink}`;
  }
  const themed = enhanceManagerWithUiFoundation(html);
  const navigated = enhanceManagerWithNavigation(themed);
  const queued = enhanceManagerWithWorkQueue(navigated);
  const operations = enhanceManagerWithAutomationReviews(queued);
  const organized = enhanceManagerWithConfigIntegrationMaintenance(operations);
  const configured = enhanceManagerWithConfigurationTabs(organized);
  const issueAndReviewViews = enhanceManagerWithIssuesPrReviews(configured);
  const issueFlow = enhanceManagerWithIssueProcessingFlow(issueAndReviewViews);
  return enhanceManagerWithInteractionPolish(issueFlow);
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
  githubSetupOptions = {},
  workspaceSetupOptions = {},
  issuesSetupOptions = {},
  reviewSetupOptions = {},
  readinessSetupOptions = {},
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
        const themedHtml = enhanceSetupWithSharedUiTheme(setupWizardHtml({ requestedPage }));
        const shellHtml = enhanceSetupWizardWithShellFeedback(themedHtml);
        const requiredHtml = enhanceSetupWizardWithRequiredState(shellHtml);
        const harnessHtml = enhanceSetupWizardWithHarnessPage(requiredHtml);
        const githubHtml = enhanceSetupWizardWithGitHubPage(harnessHtml);
        const repositoryPaseoHtml = enhanceSetupWizardWithRepositoryPaseo(githubHtml);
        const workspaceHtml = enhanceSetupWizardWithWorkspacePage(repositoryPaseoHtml);
        const issuesHtml = enhanceSetupWizardWithIssuesPage(workspaceHtml);
        const reviewHtml = enhanceSetupWizardWithReviewPage(issuesHtml);
        const readinessHtml = enhanceSetupWizardWithFinalReadiness(reviewHtml);
        response.end(enhanceSetupWizardWithSimplifiedFlow(readinessHtml));
        return;
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await readBody(request) : {};
      const pageApiOptions = { rootDir, credentialStore: credentials };

      const paseoSetup = await paseoSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { ...pageApiOptions, ...paseoSetupOptions });
      if (paseoSetup.handled) { json(response, paseoSetup.status, paseoSetup.body); return; }

      const harnessSetup = await harnessSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { ...pageApiOptions, ...harnessSetupOptions });
      if (harnessSetup.handled) { json(response, harnessSetup.status, harnessSetup.body); return; }

      const githubSetup = await githubSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { ...pageApiOptions, ...githubSetupOptions });
      if (githubSetup.handled) { json(response, githubSetup.status, githubSetup.body); return; }

      const workspaceSetup = await workspaceSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { ...pageApiOptions, ...workspaceSetupOptions });
      if (workspaceSetup.handled) { json(response, workspaceSetup.status, workspaceSetup.body); return; }

      const issuesSetup = issuesSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { rootDir, ...issuesSetupOptions });
      if (issuesSetup.handled) { json(response, issuesSetup.status, issuesSetup.body); return; }

      const reviewSetup = await reviewSetupPageApiRequest({ method: request.method, pathname: url.pathname, body }, { rootDir, ...reviewSetupOptions });
      if (reviewSetup.handled) { json(response, reviewSetup.status, reviewSetup.body); return; }

      const readinessSetup = await finalReadinessApiRequest({ method: request.method, pathname: url.pathname, body }, {
        rootDir,
        workerManager: workers,
        reviewWorkerManager: reviewWorkers,
        ...readinessSetupOptions,
      });
      if (readinessSetup.handled) { json(response, readinessSetup.status, readinessSetup.body); return; }

      const result = managerApiRequest({ method: request.method, pathname: url.pathname, body }, { rootDir, workerManager: workers, reviewWorkerManager: reviewWorkers });
      if (!result.handled) { json(response, 404, { error: 'Not found' }); return; }
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
  server.on('close', () => { workers.close(); reviewWorkers.close(); });
  if (open) openBrowser(url);
  return { server, url, workerManager: workers, reviewWorkerManager: reviewWorkers, paseoCredentialStore: credentials };
}
