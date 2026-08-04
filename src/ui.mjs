import { COMPONENTS_UI_SCRIPT } from './components-ui-script.mjs';
import { CONTROL_CENTER_SCRIPT } from './control-center-script.mjs';
import { CONTROL_CENTER_SHELL } from './control-center-shell.mjs';
import { CONTROL_CENTER_STYLE } from './control-center-style.mjs';
import { DASHBOARD_POLL_SCRIPT } from './dashboard-poll-script.mjs';
import { SETUP_CONTROLS_SCRIPT } from './setup-controls-script.mjs';
import { SETUP_REFRESH_SCRIPT } from './setup-refresh-script.mjs';

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

function shellWithPrReviews() {
  return CONTROL_CENTER_SHELL
    .replace(
      '</nav>',
      '<a class="nav-tab" href="/pr-reviews" aria-label="Open serial PR review management">PR Reviews</a></nav>',
    )
    .replace(
      /<article class="card setup-step" id="installation-card"[\s\S]*?<\/article>/,
      COMPONENTS_PANEL,
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
<style>${CONTROL_CENTER_STYLE}</style>
</head>
<body>
${shellWithPrReviews()}
<script>${CONTROL_CENTER_SCRIPT}</script>
<script>${SETUP_CONTROLS_SCRIPT}</script>
<script>${SETUP_REFRESH_SCRIPT}</script>
<script>${COMPONENTS_UI_SCRIPT}</script>
<script>${DASHBOARD_POLL_SCRIPT}</script>
</body>
</html>`;
}
