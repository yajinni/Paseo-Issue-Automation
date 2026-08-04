export const PR_REVIEW_PANEL = String.raw`
    <section class="view" id="view-pr-reviews">
      <div class="split-header">
        <div>
          <h2>Serial PR Review</h2>
          <p class="muted">Several builders, one inspector. PR review never consumes a coding slot.</p>
        </div>
        <div class="actions">
          <button class="secondary" onclick="refreshPrReviews(true)">Refresh</button>
          <button class="secondary" onclick="prReviewPost('/api/pr-reviews/reconcile')">Reconcile GitHub</button>
          <button id="pr-review-queue-toggle" class="secondary" onclick="togglePrReviewQueue()" disabled>Reviews loading…</button>
        </div>
      </div>

      <div class="health-strip pr-review-health" aria-label="PR review health">
        <span id="pr-queue-chip" class="chip">Queue unknown</span>
        <span id="pr-browser-chip" class="chip">Browser unknown</span>
        <span id="pr-auth-chip" class="chip">Authentication unknown</span>
        <span id="pr-conversation-chip" class="chip">Conversation unknown</span>
        <span id="pr-reconcile-chip" class="chip">Reconciliation unknown</span>
      </div>

      <div class="grid two pr-review-section">
        <article class="card">
          <div class="card-head"><div><h2>Active inspector</h2><p>Exactly one ChatGPT browser submission may be active globally.</p></div></div>
          <div id="pr-active-review" class="list"><div class="empty">No active review.</div></div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Waiting review line</h2><p>Queue order is independent from issue-coding priority.</p></div></div>
          <div id="pr-waiting-reviews" class="list"><div class="empty">No queued reviews.</div></div>
        </article>
      </div>

      <article class="card pr-review-section">
        <div class="split-header">
          <div><h2>Managed pull requests</h2><p class="muted">Only PRs registered by Paseo are reconciled.</p></div>
          <select id="pr-state-filter" onchange="renderManagedPrReviews()">
            <option value="all">All states</option>
            <option value="queued">Queued</option>
            <option value="awaiting_result">Awaiting result</option>
            <option value="fixing">Fixing</option>
            <option value="ready_to_merge">Ready to merge</option>
            <option value="failed">Failed</option>
            <option value="closed_unmerged">Closed unmerged</option>
          </select>
        </div>
        <div id="pr-managed-list" class="list"><div class="empty">No managed pull requests.</div></div>
      </article>

      <div class="grid two pr-review-section">
        <article class="card">
          <div class="card-head"><div><h2>Project review settings</h2><p>Configure the serial review queue and GitHub completion behavior.</p></div></div>
          <div class="field-grid">
            <label>Enable PR automation<select id="pr-enabled"><option value="false">Disabled</option><option value="true">Enabled</option></select></label>
            <label>Enable ChatGPT browser reviews<select id="pr-browser-enabled"><option value="false">Disabled</option><option value="true">Enabled</option></select></label>
            <label>Project conversation URL<input id="pr-project-url" placeholder="https://chatgpt.com/c/..."></label>
            <label>Review debounce in seconds<input id="pr-debounce" type="number" min="0" max="600" step="1"></label>
            <label>Active reconciliation in seconds<input id="pr-active-interval" type="number" min="10" max="3600" step="1"></label>
            <label>Idle reconciliation in seconds<input id="pr-idle-interval" type="number" min="30" max="86400" step="1"></label>
            <label>Maximum browser submission attempts<input id="pr-max-attempts" type="number" min="1" max="10"></label>
            <label>Allow ChatGPT merge<select id="pr-allow-merge"><option value="false">No</option><option value="true">Yes</option></select></label>
            <label>Verify associated issue closure<select id="pr-verify-closure"><option value="true">Yes</option><option value="false">No</option></select></label>
            <label>Allow safe Paseo issue-closure fallback<select id="pr-closure-fallback"><option value="false">No</option><option value="true">Yes</option></select></label>
          </div>
          <label class="pr-review-section">Versioned review prompt template<textarea id="pr-prompt"></textarea></label>
          <div class="actions pr-review-section"><button onclick="savePrReviewSettings()">Save settings</button></div>
        </article>

        <article class="card">
          <div class="card-head"><div><h2>Dedicated ChatGPT browser</h2><p>Manage the isolated browser used by serial PR review for this project.</p></div></div>
          <div id="pr-browser-status" class="meta-grid"></div>
          <div class="actions pr-review-section">
            <button onclick="installPrReviewBrowser()">Install Chromium</button>
            <button class="secondary" onclick="prReviewPost('/api/pr-reviews/browser/open')">Launch browser</button>
            <button class="secondary" onclick="prReviewPost('/api/pr-reviews/browser/use-current',{scope:'project'})">Use current conversation</button>
            <button class="secondary" onclick="prReviewPost('/api/pr-reviews/browser/test')">Test destination</button>
            <button class="secondary" onclick="prReviewPost('/api/pr-reviews/browser/test',{sendTestPrompt:true})">Send harmless test</button>
            <button class="secondary" onclick="prReviewPost('/api/pr-reviews/browser/close')">Close browser</button>
          </div>
          <div class="actions pr-review-section">
            <button class="danger" onclick="openPrReviewConfirm('Reset dedicated profile','RESET','/api/pr-reviews/browser/reset')">Reset profile</button>
            <button class="danger" onclick="openPrReviewConfirm('Uninstall browser','UNINSTALL','/api/pr-reviews/browser/uninstall')">Uninstall browser</button>
          </div>
        </article>
      </div>

      <article class="card pr-review-section">
        <div class="card-head"><div><h2>State-transition history</h2><p>Persistent audit history across restarts.</p></div></div>
        <div id="pr-history" class="timeline"><div class="empty">No history.</div></div>
      </article>

      <dialog id="pr-override-dialog">
        <div class="dialog-head"><div><h2>One-time review destination</h2><p class="muted">This affects only the new review job.</p></div><button class="ghost small" onclick="closeDialog('pr-override-dialog')">Close</button></div>
        <div class="dialog-body"><input id="pr-override-managed-id" type="hidden"><label>ChatGPT conversation URL for this review only<input id="pr-override-url" placeholder="https://chatgpt.com/c/..."></label></div>
        <div class="dialog-footer"><button class="secondary" onclick="closeDialog('pr-override-dialog')">Cancel</button><button onclick="submitPrReviewOverride()">Queue review</button></div>
      </dialog>

      <dialog id="pr-manual-dialog">
        <div class="dialog-head"><div><h2>Manual review result</h2><p class="muted">Record a result without a browser submission.</p></div><button class="ghost small" onclick="closeDialog('pr-manual-dialog')">Close</button></div>
        <div class="dialog-body"><input id="pr-manual-managed-id" type="hidden"><label>Result<select id="pr-manual-result"><option value="changes_requested">Changes requested</option><option value="approved">Approved</option></select></label><label class="pr-review-section">Findings<textarea id="pr-manual-findings"></textarea></label></div>
        <div class="dialog-footer"><button class="secondary" onclick="closeDialog('pr-manual-dialog')">Cancel</button><button onclick="submitPrManualResult()">Record result</button></div>
      </dialog>

      <dialog id="pr-confirm-dialog">
        <div class="dialog-head"><div><h2 id="pr-confirm-title">Confirm action</h2><p class="muted" id="pr-confirm-text"></p></div><button class="ghost small" onclick="closeDialog('pr-confirm-dialog')">Close</button></div>
        <div class="dialog-body"><label>Confirmation phrase<input id="pr-confirm-input" autocomplete="off"></label></div>
        <div class="dialog-footer"><button class="secondary" onclick="closeDialog('pr-confirm-dialog')">Cancel</button><button id="pr-confirm-button" class="danger" disabled>Continue</button></div>
      </dialog>
    </section>`;
