import { COMPONENTS_UI_SCRIPT } from './components-ui-script.mjs';
import { CONTROLLER_ACTIONS_UI_SCRIPT } from './controller-actions-ui-script.mjs';
import { CONTROL_CENTER_SCRIPT } from './control-center-script.mjs';
import { CONTROL_CENTER_SHELL } from './control-center-shell.mjs';
import { CONTROL_CENTER_STYLE } from './control-center-style.mjs';
import { DASHBOARD_POLL_SCRIPT } from './dashboard-poll-script.mjs';
import { PR_REVIEW_DASHBOARD_SCRIPT } from './pr-review-dashboard-script.mjs';
import { PR_REVIEW_DASHBOARD_STYLE } from './pr-review-dashboard-style.mjs';
import { PR_REVIEW_PANEL } from './pr-review-panel.mjs';
import { SETUP_CATALOG_FEEDBACK_SCRIPT } from './setup-catalog-feedback-script.mjs';
import { SETUP_CONTROLS_SCRIPT } from './setup-controls-script.mjs';
import { SETUP_REFRESH_SCRIPT } from './setup-refresh-script.mjs';

const CONTROL_CENTER_SCRIPT_WITHOUT_MAINTENANCE = CONTROL_CENTER_SCRIPT
  .replace(
    /\nfunction uninstallPayload\(\) \{[\s\S]*?\n\}\n\nfunction findAttempt/,
    '\nfunction findAttempt',
  )
  .replace("  document.getElementById('state-path').textContent = data.stateDirectory || 'Unknown';\n", '')
  .replace("  document.getElementById('npm-uninstall-command').textContent = data.npmUninstallCommand || '';\n", '')
  .replace(" && currentView !== 'maintenance'", '')
  .replace(
    /\nfunction renderHealth\(data\) \{[\s\S]*?\n\}\n\nfunction renderCounts/,
    '\nfunction renderCounts',
  );

const CONTROLLER_ACTIONS_PANEL = String.raw`      <div class="header-actions controller-action-bar" id="controller-actions" data-state="loading">
        <span class="chip info" id="controller-action-state">Controller loading</span>
        <button id="claims-toggle-button" class="secondary" onclick="toggleClaims()" disabled>Claims unavailable</button>
        <button id="run-now-button" class="secondary" onclick="postAction('/api/run-now')" disabled>Run now</button>
        <button id="reconcile-button" class="secondary" onclick="postAction('/api/reconcile')" disabled>Reconcile dependencies</button>
      </div>`;

const COMPONENTS_PANEL = String.raw`
      <article class="card setup-step" id="installation-card" style="margin-top:14px">
        <div class="card-head">
          <div><h2>Components</h2><p>Install, monitor, repair, or uninstall package-managed components.</p></div>
          <button id="components-action" onclick="componentsAction()">Install components</button>
        </div>
        <div class="component-list" style="margin-top:12px">
          <div class="component" id="component-issue-template" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px">
            <div>
              <strong>Issue template</strong>
              <p class="muted code" style="margin:4px 0">.github/ISSUE_TEMPLATE/automated-coding-task.md</p>
              <p id="issue-template-status" style="margin:0" aria-live="polite">Checking…</p>
            </div>
            <div class="actions">
              <span id="issue-template-badge"><span class="status-dot"></span></span>
              <button id="reinstall-issue-template" class="small warning hidden" onclick="reinstallComponent('issueTemplate')">Reinstall</button>
            </div>
          </div>
          <div class="component" id="component-paseo-service" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px">
            <div>
              <strong>Paseo automation service</strong>
              <p class="muted code" style="margin:4px 0">paseo.json → scripts.issue-coding-automation</p>
              <p id="paseo-json-status" style="margin:0" aria-live="polite">Checking…</p>
            </div>
            <div class="actions">
              <span id="paseo-json-badge"><span class="status-dot"></span></span>
              <button id="reinstall-paseo-service" class="small warning hidden" onclick="reinstallComponent('paseoService')">Reinstall</button>
            </div>
          </div>
          <div class="component" id="component-github-labels" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px">
            <div>
              <strong>GitHub lifecycle labels</strong>
              <p id="labels-status" style="margin:4px 0 0" aria-live="polite">Checking…</p>
            </div>
            <div class="actions">
              <span id="labels-badge"><span class="status-dot"></span></span>
              <button id="reinstall-labels" class="small warning hidden" onclick="reinstallComponent('labels')">Reinstall</button>
            </div>
          </div>
          <div class="component" id="component-workspace" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px">
            <div>
              <strong>Permanent Paseo workspace</strong>
              <p id="workspace" style="margin:4px 0 0" aria-live="polite">Checking…</p>
            </div>
            <div class="actions">
              <span id="workspace-badge"><span class="status-dot"></span></span>
              <button id="reinstall-workspace" class="small warning hidden" onclick="reinstallComponent('workspace')">Reinstall</button>
            </div>
          </div>
        </div>
        <div class="hidden" aria-hidden="true">
          <span id="install-preview"></span>
          <span id="install-issue-template"></span>
          <span id="repair-issue-template"></span>
          <span id="remove-issue-template"></span>
          <span id="install-paseo-service"></span>
          <span id="repair-paseo-service"></span>
          <span id="remove-paseo-integration"></span>
          <div id="label-list"></div>
          <span id="remove-workspace"></span>
        </div>
      </article>`;

function integratedDashboardShell() {
  return CONTROL_CENTER_SHELL
    .replace(
      /      <div class="header-actions" id="controller-actions">[\s\S]*?      <\/div>/,
      CONTROLLER_ACTIONS_PANEL,
    )
    .replace(
      '    <button class="nav-tab" data-view="maintenance" onclick="showView(\'maintenance\')">Maintenance</button>\n',
      '',
    )
    .replace(
      '</nav>',
      '    <button class="nav-tab" data-view="pr-reviews" onclick="showView(\'pr-reviews\')">PR Reviews</button>\n  </nav>',
    )
    .replace(
      /<article class="card setup-step" id="installation-card"[\s\S]*?<\/article>/,
      COMPONENTS_PANEL,
    )
    .replace(
      /\n    <section class="view" id="view-maintenance">[\s\S]*?<\/section>\n  <\/main>/,
      '\n  </main>',
    )
    .replace(
      '\n  </main>',
      '\n' + PR_REVIEW_PANEL + '\n  </main>',
    );
}

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#090d14">
<title>Issue Execution Controller</title>
<style>${CONTROL_CENTER_STYLE}\n${PR_REVIEW_DASHBOARD_STYLE}</style>
</head>
<body>
${integratedDashboardShell()}
<script>${CONTROL_CENTER_SCRIPT_WITHOUT_MAINTENANCE}</script>
<script>${SETUP_CONTROLS_SCRIPT}</script>
<script>${SETUP_REFRESH_SCRIPT}</script>
<script>${SETUP_CATALOG_FEEDBACK_SCRIPT}</script>
<script>${COMPONENTS_UI_SCRIPT}</script>
<script>${CONTROLLER_ACTIONS_UI_SCRIPT}</script>
<script>${PR_REVIEW_DASHBOARD_SCRIPT}</script>
<script>${DASHBOARD_POLL_SCRIPT}</script>
</body>
</html>`;
}
