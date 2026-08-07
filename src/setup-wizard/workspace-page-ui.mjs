export const WORKSPACE_PAGE_SCRIPT = String.raw`
(function workspaceSetupPage() {
  let state = null;
  let loading = false;
  const content = () => document.getElementById('page-content');
  const pageId = () => location.pathname.replace(/\/$/, '').split('/').at(-1);
  const onPage = () => ['checkout', 'workspace'].includes(pageId());

  function escape(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function checkRow(label, ok, detail) {
    return '<div class="check-row ' + (ok ? 'ok' : 'bad') + '"><span class="check-dot">' + (ok ? '✓' : '!') + '</span><div><strong>' + escape(label) + '</strong><div class="check-detail">' + escape(detail || '') + '</div></div></div>';
  }
  function currentCheck() { return pageId() === 'workspace' ? state?.workspaceCheck : state?.checkoutCheck; }
  function cardClass(missing) { return 'setup-card' + (missing ? ' required-missing' : ''); }

  function render() {
    if (!onPage() || !state || !content()) return;
    const checkoutPage = pageId() === 'checkout';
    const selection = state.selection || {};
    const candidates = state.candidates || [];
    const safeChoices = state.safeChoices || [];
    const selected = selection.checkoutPath;
    const candidateRows = candidates.map((candidate) => checkRow(
      candidate.path,
      candidate.valid,
      candidate.valid ? (candidate.managed ? 'Safe managed checkout.' : 'Safe existing checkout.') : (candidate.reasons || []).map((reason) => reason.message).join(' '),
    )).join('');
    const choiceOptions = ['<option value="">Automatic choice</option>'].concat(safeChoices.map((candidate) => '<option value="' + escape(candidate.path) + '"' + (candidate.path === selected ? ' selected' : '') + '>' + escape(candidate.path) + (candidate.managed ? ' · managed' : '') + '</option>')).join('');
    const actionText = state.automaticAction === 'clone-managed'
      ? 'No safe existing checkout was found. Setup will create a new managed clone in the manager-owned repository directory.'
      : state.automaticAction === 'reuse-existing'
        ? 'Exactly one safe existing checkout was found and can be reused automatically.'
        : 'Multiple safe checkouts were found. Choose which checkout Paseo should manage.';
    const workspace = state.workspace || null;
    const workspaceId = selection.workspaceId || workspace?.workspace?.workspace?.id || workspace?.workspace?.id || '';
    const cleanup = workspace?.readiness?.cleanup || state.technicalDetails?.cleanup || null;
    const checkoutMissing = state.checkoutCheck?.ok !== true;
    const workspaceMissing = state.workspaceCheck?.ok !== true;

    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="setup-card"><h3>' + (checkoutPage ? 'Local checkout' : 'Paseo workspace') + '</h3><p>Repository: <strong>' + escape(state.repository?.nameWithOwner) + '</strong> · Base branch: <strong>' + escape(state.baseBranch) + '</strong></p>'
      + (checkoutPage ? '<div class="notice">' + escape(actionText) + '</div>' : '<div class="notice">The permanent Paseo workspace is verified against the registered checkout, then a temporary isolated worktree is created and safely cleaned up without sending a paid model request.</div>')
      + '</section>'
      + (checkoutPage ? '<section class="' + cardClass(checkoutMissing) + '"><h3>Safe checkout discovery</h3><p>Setup checks only manager-known repositories, Paseo workspaces, and the manager-owned clone directory. Dirty user clones are shown but never altered.</p><div class="checklist">' + (candidateRows || '<div class="notice">No known checkout candidates were found.</div>') + '</div>'
        + (safeChoices.length > 1 ? '<div class="field"><label for="workspace-checkout-choice">Checkout to use</label><select id="workspace-checkout-choice">' + choiceOptions + '</select></div>' : '')
        + '<div class="inline-actions"><button class="action primary" id="workspace-prepare" type="button">' + (state.automaticAction === 'clone-managed' ? 'Clone and prepare workspace' : 'Use checkout and prepare workspace') + '</button><button class="action" id="workspace-refresh" type="button">Refresh checkouts</button></div></section>' : '')
      + '<section class="' + cardClass(workspaceMissing) + '"><h3>Workspace readiness</h3><div class="checklist">'
      + checkRow('Registered checkout', Boolean(selection.checkoutPath), selection.checkoutPath || 'Not prepared yet.')
      + checkRow('Permanent Paseo workspace', Boolean(workspaceId), workspaceId || 'Not verified yet.')
      + checkRow('Isolated worktree probe', Boolean(cleanup && cleanup.pathRemoved && cleanup.branchRemoved && cleanup.directoryRemoved), cleanup ? 'Temporary worktree, branch, and directory cleanup verified.' : 'Readiness probe has not passed yet.')
      + checkRow('Paid model request', state.technicalDetails?.paidModelRequestSent !== true, 'No paid model prompt is sent during readiness checks.')
      + '</div>'
      + (!checkoutPage ? '<div class="inline-actions"><button class="action primary" id="workspace-prepare" type="button">Verify workspace readiness</button><button class="action" id="workspace-refresh" type="button">Check workspace again</button></div>' : '')
      + (state.blocker ? '<div class="notice">' + escape(state.blocker.message) + ' ' + escape(state.blocker.recoveryAction || '') + '</div>' : '')
      + '</section></div>';

    document.getElementById('workspace-prepare')?.addEventListener('click', () => prepare());
    document.getElementById('workspace-refresh')?.addEventListener('click', () => refresh(true));
    if (typeof technical !== 'undefined') {
      technical = state.technicalDetails || {};
      const details = document.getElementById('technical-details');
      if (details) details.textContent = JSON.stringify(technical, null, 2);
    }
    const shellStatus = document.getElementById('status');
    const check = currentCheck();
    if (shellStatus && check) {
      shellStatus.className = 'status ' + (check.ok ? 'ok' : 'blocked');
      shellStatus.innerHTML = '<div class="status-title">' + escape(check.ok ? 'Requirements passed' : 'Needs attention') + '</div><div class="status-copy">' + escape(check.summary || '') + '</div>';
    }
  }

  async function syncShell() {
    const latest = await api('/api/setup/session');
    if (typeof store !== 'undefined') store = latest;
    if (typeof render === 'function') render();
  }
  async function prepare() {
    if (loading) return;
    loading = true;
    try {
      state = await api('/api/setup/workspace/prepare', { method: 'POST', body: JSON.stringify({ checkoutPath: document.getElementById('workspace-checkout-choice')?.value || state?.selection?.checkoutPath || '' }) });
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function refresh(force = false) {
    if (!onPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try {
      state = await api(force ? '/api/setup/workspace/recheck' : '/api/setup/workspace/status', { method: force ? 'POST' : 'GET', body: force ? '{}' : undefined });
      if (force) await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  const observer = new MutationObserver(() => { if (onPage() && content() && !content().querySelector('#workspace-prepare')) refresh(false); });
  const title = document.getElementById('page-title'); if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content(); if (root) observer.observe(root, { childList: true });
  document.getElementById('recheck')?.addEventListener('click', (event) => { if (!onPage()) return; event.preventDefault(); event.stopImmediatePropagation(); refresh(true); }, true);
  addEventListener('popstate', () => { if (onPage()) refresh(false); });
  if (onPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithWorkspacePage(html) {
  const script = `<script data-setup-workspace-page>${WORKSPACE_PAGE_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
