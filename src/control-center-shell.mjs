export const CONTROL_CENTER_SHELL = String.raw`
<a class="skip-link" href="#main-content">Skip to dashboard content</a>
<div class="app-shell">
  <header class="app-header">
    <div class="header-top">
      <div class="brand">
        <h1>Issue Execution Controller</h1>
        <p id="subtitle">Loading controller status…</p>
      </div>
      <div class="header-actions" id="controller-actions">
        <button id="resume-button" onclick="postAction('/api/resume')">Resume claims</button>
        <button class="secondary" onclick="postAction('/api/run-now')">Run now</button>
        <button class="secondary" onclick="postAction('/api/reconcile')">Reconcile dependencies</button>
        <button class="danger" id="pause-button" onclick="postAction('/api/pause')">Pause claims</button>
      </div>
    </div>
    <div class="health-strip" aria-label="Controller health">
      <span class="chip" id="health-claims">Claims unknown</span>
      <span class="chip" id="health-capacity">Capacity unknown</span>
      <span class="chip" id="health-poll">Next poll unknown</span>
      <span class="chip" id="health-github">GitHub unknown</span>
      <span class="chip" id="health-paseo">Paseo unknown</span>
      <span class="chip" id="health-dependencies">Dependencies unknown</span>
    </div>
  </header>

  <nav class="nav-tabs" aria-label="Dashboard sections">
    <button class="nav-tab active" data-view="overview" onclick="showView('overview')">Overview</button>
    <button class="nav-tab" data-view="issues" onclick="showView('issues')">Issues</button>
    <button class="nav-tab" data-view="dependencies" onclick="showView('dependencies')">Dependencies</button>
    <button class="nav-tab" data-view="activity" onclick="showView('activity')">Activity</button>
    <button class="nav-tab" data-view="settings" onclick="showView('settings')">Settings</button>
    <button class="nav-tab" data-view="maintenance" onclick="showView('maintenance')">Maintenance</button>
  </nav>

  <main id="main-content">
    <section class="view active" id="view-overview">
      <div class="grid metrics" id="metric-grid">
        <button class="card metric" onclick="filterIssues('agent-ready')"><span class="label">Ready</span><span class="value" id="count-ready">0</span></button>
        <button class="card metric" onclick="filterIssues('agent-running')"><span class="label">Running</span><span class="value" id="count-running">0</span></button>
        <button class="card metric" onclick="filterIssues('automation-blocked')"><span class="label">Blocked</span><span class="value" id="count-blocked">0</span></button>
        <button class="card metric failed" onclick="filterIssues('automation-failed')"><span class="label">Failed</span><span class="value" id="count-failed">0</span></button>
        <button class="card metric review" onclick="filterIssues('human-review')"><span class="label">Human review</span><span class="value" id="count-humanReview">0</span></button>
      </div>

      <div class="section-stack" style="margin-top:14px">
        <article class="card">
          <div class="card-head">
            <div><h2>Needs your review</h2><p>PRs that passed validation, independent review, base freshness, and CI.</p></div>
          </div>
          <div class="list" id="human-review-list"><div class="empty">Nothing is waiting for human review.</div></div>
        </article>

        <div class="grid two">
          <article class="card">
            <div class="card-head"><div><h2>Active execution</h2><p>Current coding, validation, review, repair, and CI work.</p></div></div>
            <div class="list" id="active-execution-list"><div class="empty">No active issue attempts.</div></div>
          </article>
          <article class="card">
            <div class="card-head"><div><h2>Dependency queue</h2><p>Blocked work and the prerequisite merges that will unlock it.</p></div></div>
            <div class="list" id="dependency-queue-list"><div class="empty">No dependency-blocked issues.</div></div>
          </article>
        </div>

        <div class="grid two">
          <article class="card">
            <div class="card-head"><div><h2>Scheduling</h2><p>Controller capacity, polling, and most recent dispatch result.</p></div></div>
            <div id="scheduling-summary" class="meta-grid"></div>
            <pre id="last-dispatch-result" style="margin-top:12px">No dispatch has been recorded.</pre>
          </article>
          <article class="card">
            <div class="card-head"><div><h2>Recent activity</h2><p>Newest controller, Coder, Reviewer, and validation events.</p></div><button class="small secondary" onclick="showView('activity')">View all</button></div>
            <div class="timeline" id="overview-activity"><div class="empty">No activity recorded.</div></div>
          </article>
        </div>
      </div>
    </section>

    <section class="view" id="view-issues">
      <article class="card">
        <div class="split-header">
          <div><h2>Issue execution board</h2><p class="muted">Filter the complete controller queue and open any card for exact commit, review, CI, and timeline details.</p></div>
          <button class="secondary" onclick="refreshStatus()">Refresh status</button>
        </div>
        <div class="filters" id="issue-filters">
          <button class="filter-button active" data-filter="all" onclick="filterIssues('all')">All</button>
          <button class="filter-button" data-filter="agent-ready" onclick="filterIssues('agent-ready')">Ready</button>
          <button class="filter-button" data-filter="agent-running" onclick="filterIssues('agent-running')">Running</button>
          <button class="filter-button" data-filter="automation-blocked" onclick="filterIssues('automation-blocked')">Blocked</button>
          <button class="filter-button" data-filter="automation-failed" onclick="filterIssues('automation-failed')">Failed</button>
          <button class="filter-button" data-filter="human-review" onclick="filterIssues('human-review')">Human review</button>
        </div>
        <div class="list" id="issue-list"><div class="empty">No issues found.</div></div>
      </article>
    </section>

    <section class="view" id="view-dependencies">
      <div class="grid two">
        <article class="card">
          <div class="card-head"><div><h2>Execution waves</h2><p>Topological work groups calculated from native GitHub blocked-by relationships.</p></div></div>
          <div id="execution-waves"><div class="empty">No dependency graph available.</div></div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Graph health</h2><p>Dependency API status, cycles, and unresolved graph nodes.</p></div></div>
          <div id="graph-health" class="section-stack"></div>
        </article>
      </div>
      <article class="card" style="margin-top:14px">
        <div class="card-head"><div><h2>Dependency map</h2><p>Every issue, what blocks it, and what it blocks.</p></div></div>
        <div class="grid three" id="dependency-map"><div class="empty">No dependency relationships found.</div></div>
      </article>
    </section>

    <section class="view" id="view-activity">
      <article class="card">
        <div class="split-header">
          <div><h2>Controller activity</h2><p class="muted">Append-only local execution history across issue attempts.</p></div>
          <div class="actions"><button class="secondary" onclick="copyAllActivity()">Copy activity</button><button class="secondary" onclick="downloadAllActivity()">Download JSON</button></div>
        </div>
        <div class="timeline" id="activity-list"><div class="empty">No activity recorded.</div></div>
      </article>
    </section>

    <section class="view" id="view-settings">
      <div class="grid two">
        <article class="card setup-step" id="requirements-card">
          <div class="card-head"><div><h2>Requirements</h2><p>Read-only connectivity and repository checks.</p></div><button class="small secondary" onclick="refreshStatus()">Check again</button></div>
          <pre id="requirements">Loading…</pre>
        </article>
        <article class="card setup-step" id="config-card">
          <div class="card-head"><div><h2>Controller configuration</h2><p>The controller is deterministic; only Coder and Reviewer models are selected.</p></div></div>
          <div class="field-grid">
            <label>Base branch<input id="baseBranch"></label>
            <label>Polling interval in seconds<input id="pollIntervalSeconds" type="number" min="60" max="3600"></label>
            <label>Coder model<input id="coder" placeholder="provider/model"></label>
            <label>Independent Reviewer model<input id="reviewer" placeholder="provider/model"></label>
            <label>Maximum active issues<input id="maxActive" type="number" min="1" max="10"></label>
            <label>Maximum review rounds<input id="maxReviewRounds" type="number" min="1" max="10"></label>
          </div>
          <div class="actions" style="margin-top:12px"><button onclick="saveConfig()">Save configuration</button><button class="secondary" onclick="runSelfTest()">Run self-test</button><button class="secondary" onclick="postAction('/api/finish')">Finish setup</button></div>
          <pre id="self-test" style="margin-top:12px">Self-test not run.</pre>
        </article>
      </div>

      <article class="card setup-step" id="installation-card" style="margin-top:14px">
        <div class="card-head"><div><h2>Installation and repairs</h2><p>Preview and manage only package-owned components.</p></div><div class="actions"><button class="secondary" onclick="loadPreview()">Refresh preview</button><button onclick="installAll()">Install shown components</button></div></div>
        <pre id="install-preview">Loading preview…</pre>
        <div class="component-list" style="margin-top:12px">
          <div class="component">
            <div class="component-head"><code>.github/ISSUE_TEMPLATE/automated-coding-task.md</code><span id="issue-template-badge"></span></div>
            <p id="issue-template-status">Checking…</p>
            <div class="actions"><button id="install-issue-template" class="secondary" onclick="postAction('/api/install/issue-template')">Install</button><button id="repair-issue-template" class="warning hidden" onclick="confirmAction('Restore package issue template','Replace the package-managed template with the package version?', '/api/repair/issue-template')">Restore package version</button><button id="remove-issue-template" class="danger hidden" onclick="confirmAction('Remove issue template','Remove the unchanged package-created issue template?', '/api/remove/issue-template')">Remove installed file</button></div>
          </div>
          <div class="component">
            <div class="component-head"><code>paseo.json → scripts.issue-coding-automation</code><span id="paseo-json-badge"></span></div>
            <p id="paseo-json-status">Checking…</p>
            <div class="actions"><button id="install-paseo-service" class="secondary" onclick="postAction('/api/install/paseo-service')">Install service</button><button id="repair-paseo-service" class="warning hidden" onclick="confirmAction('Repair Paseo service','Restore only the package-owned service entry?', '/api/repair/paseo-service')">Repair added service</button><button id="remove-paseo-integration" class="danger hidden" onclick="confirmAction('Remove Paseo integration','Remove only the package-owned Paseo integration?', '/api/remove/paseo-integration')">Remove package addition</button></div>
          </div>
          <div class="component">
            <div class="component-head"><strong>GitHub lifecycle labels</strong><span id="labels-badge"></span></div>
            <p>Pre-existing matching labels are reused but never treated as package-owned.</p>
            <div id="label-list" class="component-list"></div>
            <div class="actions" style="margin-top:10px"><button class="secondary" onclick="postAction('/api/install/labels')">Install or repair missing labels</button></div>
          </div>
          <div class="component">
            <div class="component-head"><strong>Permanent Paseo workspace</strong><span id="workspace-badge"></span></div>
            <p id="workspace">Checking…</p>
            <div class="actions"><button class="secondary" onclick="postAction('/api/workspace')">Create or reconnect</button><button id="remove-workspace" class="danger hidden" onclick="confirmAction('Archive workspace','Archive the package-created Issue Coding Automation workspace?', '/api/remove/workspace')">Archive workspace</button></div>
          </div>
        </div>
      </article>
    </section>

    <section class="view" id="view-maintenance">
      <div class="grid two">
        <article class="card">
          <div class="card-head"><div><h2>Local state</h2><p>Ownership records used for safe repair and uninstall.</p></div></div>
          <p class="code" id="state-path">Loading…</p>
          <div class="actions"><button class="danger" onclick="confirmAction('Clear local state','Clear local state only after package-managed components have been removed?', '/api/clear-state', {force:false})">Clear local state</button><button class="danger" onclick="typedConfirmAction('Force clear ownership records','This permanently loses ownership records used for safe cleanup.','CLEAR','/api/clear-state',{force:true})">Force clear ownership records</button></div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Lifecycle labels</h2><p>Remove package-created labels individually or in bulk.</p></div></div>
          <div class="actions"><button class="danger" onclick="confirmAction('Remove labels','Remove package-created labels not used by open issues?', '/api/remove/labels',{force:false})">Remove safe labels</button><button class="danger" onclick="typedConfirmAction('Force remove labels','GitHub will remove these labels from open issues.','REMOVE','/api/remove/labels',{force:true})">Force remove all</button></div>
        </article>
      </div>

      <article class="card" style="margin-top:14px">
        <div class="card-head"><div><h2>Guided uninstall</h2><p>New claims are paused first. Active issue runs block destructive cleanup.</p></div></div>
        <div class="field-grid">
          <label><span><input id="uninstall-template" type="checkbox" checked> Remove package-created issue template</span></label>
          <label><span><input id="uninstall-paseo" type="checkbox" checked> Remove package-owned paseo.json service</span></label>
          <label><span><input id="uninstall-labels" type="checkbox" checked> Remove package-created labels</span></label>
          <label><span><input id="uninstall-workspace" type="checkbox" checked> Archive package-created workspace</span></label>
          <label><span><input id="uninstall-state" type="checkbox" checked> Clear local state last</span></label>
          <label><span><input id="uninstall-force-labels" type="checkbox"> Force labels used by open issues</span></label>
        </div>
        <div class="actions" style="margin-top:12px"><button class="danger" onclick="typedConfirmAction('Run guided uninstall','Run the selected cleanup steps?','UNINSTALL','/api/uninstall',uninstallPayload())">Run selected uninstall steps</button></div>
        <p class="muted">After dashboard cleanup, close the server and run:</p>
        <pre id="npm-uninstall-command"></pre>
      </article>
    </section>
  </main>
</div>

<div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="true"></div>

<dialog id="issue-dialog">
  <div class="dialog-head"><div><h2 id="issue-dialog-title">Issue details</h2><p class="muted" id="issue-dialog-subtitle"></p></div><button class="ghost small" onclick="closeDialog('issue-dialog')">Close</button></div>
  <div class="dialog-body" id="issue-dialog-body"></div>
  <div class="dialog-footer" id="issue-dialog-footer"><button class="secondary" onclick="closeDialog('issue-dialog')">Close</button></div>
</dialog>

<dialog id="action-dialog">
  <div class="dialog-head"><div><h2 id="action-dialog-title">Confirm action</h2><p class="muted" id="action-dialog-description"></p></div><button class="ghost small" onclick="closeDialog('action-dialog')">Close</button></div>
  <div class="dialog-body" id="action-dialog-body"></div>
  <div class="dialog-footer"><button class="secondary" onclick="closeDialog('action-dialog')">Cancel</button><button id="action-dialog-confirm">Continue</button></div>
</dialog>
`;
