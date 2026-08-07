export const GITHUB_PAGE_SCRIPT = String.raw`
(function githubSetupPage() {
  let state = null;
  let loading = false;
  let filter = '';
  const content = () => document.getElementById('page-content');
  const onPage = () => location.pathname.replace(/\/$/, '') === '/setup/repository';

  function escape(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function option(value, label, selected, disabled = false) {
    return '<option value="' + escape(value) + '"' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + escape(label) + '</option>';
  }
  function activeAccount() { return state?.auth?.activeAccount || null; }
  function selectedRepo() { return state?.repositories?.find((repo) => repo.nameWithOwner === (document.getElementById('github-repository')?.value || state?.selection?.repository)) || null; }
  function disabledText(repo) { return (repo.disabledReasons || []).map((reason) => reason.message).join(' '); }

  function render() {
    if (!onPage() || !state || !content()) return;
    const selection = state.selection || {};
    const account = activeAccount();
    const accounts = state.auth?.accounts || [];
    const repos = (state.repositories || []).filter((repo) => !filter || [repo.nameWithOwner, repo.visibility, repo.owner].some((value) => String(value || '').toLowerCase().includes(filter.toLowerCase())));
    const repo = selectedRepo();
    const branchChoices = [option('', state.branches?.length ? 'Choose a base branch' : 'Choose a repository first', !selection.baseBranch)];
    for (const branch of state.branches || []) branchChoices.push(option(branch.name, branch.name + (branch.recommended ? ' — recommended' : ''), branch.name === selection.baseBranch));
    const accountRows = accounts.map((item) => '<div class="check-row ' + (item.active ? 'ok' : '') + '"><span class="check-dot">' + (item.active ? '✓' : '·') + '</span><div><strong>' + escape(item.login) + '</strong><div class="check-detail">' + escape(item.host) + (item.active ? ' · active' : '') + '</div>' + (!item.active ? '<button class="action" type="button" data-github-switch="' + escape(item.login) + '" data-github-host="' + escape(item.host) + '">Use account</button>' : '') + '</div></div>').join('');
    const repoOptions = [option('', repos.length ? 'Choose a repository' : 'No repositories found', !selection.repository)];
    for (const item of repos) repoOptions.push(option(item.nameWithOwner, item.nameWithOwner + ' · ' + (item.visibility || 'unknown') + (item.selectable ? '' : ' · unavailable'), item.nameWithOwner === selection.repository, !item.selectable));

    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="setup-card"><h3>GitHub CLI and account</h3><p>The wizard uses GitHub CLI as the authentication boundary. Tokens are never copied into setup state.</p>'
      + '<div class="checklist">' + (state.cli?.installed ? '<div class="check-row ok"><span class="check-dot">✓</span><div><strong>GitHub CLI</strong><div class="check-detail">' + escape(state.cli.version || state.cli.path || 'Installed') + '</div></div></div>' : '<div class="check-row bad"><span class="check-dot">!</span><div><strong>GitHub CLI required</strong><div class="check-detail">Install gh, then recheck.</div></div></div>') + accountRows + '</div>'
      + '<div class="inline-actions"><button class="action" id="github-add-account" type="button">Add account</button>' + (account ? '<button class="action" id="github-reauth" type="button">Reauthenticate</button><button class="action" id="github-setup-git" type="button">Set up Git credentials</button>' : '') + '</div></section>'
      + '<section class="setup-card"><h3>Repository</h3><p>Only repositories with the read, branch-push, pull-request, issue, and label capabilities required by automation can be selected.</p>'
      + '<div class="field"><label for="github-repository-filter">Filter repositories</label><input id="github-repository-filter" type="text" value="' + escape(filter) + '" placeholder="owner or repository"></div>'
      + '<div class="field"><label for="github-repository">Repository</label><select id="github-repository">' + repoOptions.join('') + '</select></div>'
      + (repo && !repo.selectable ? '<div class="notice">' + escape(disabledText(repo)) + '</div>' : '')
      + (state.catalogBlocker ? '<div class="notice">' + escape(state.catalogBlocker.message) + ' ' + escape(state.catalogBlocker.recoveryAction || '') + '</div>' : '')
      + '</section>'
      + '<section class="setup-card"><h3>Base branch</h3><p>The repository default branch is recommended, but any discovered branch may be selected. Protected base branches remain valid.</p>'
      + '<div class="field"><label for="github-base-branch">Base branch</label><select id="github-base-branch">' + branchChoices.join('') + '</select></div>'
      + (state.branchBlocker ? '<div class="notice">' + escape(state.branchBlocker.message) + ' ' + escape(state.branchBlocker.recoveryAction || '') + '</div>' : '')
      + '<div class="inline-actions"><button class="action primary" id="github-save" type="button">Save repository</button><button class="action" id="github-refresh" type="button">Refresh repositories</button></div></section>'
      + '</div>';

    document.querySelectorAll('[data-github-switch]').forEach((button) => button.addEventListener('click', () => accountAction('switch', { user: button.dataset.githubSwitch, host: button.dataset.githubHost })));
    document.getElementById('github-add-account')?.addEventListener('click', () => accountAction('add'));
    document.getElementById('github-reauth')?.addEventListener('click', () => accountAction('reauthenticate', { host: account?.host }));
    document.getElementById('github-setup-git')?.addEventListener('click', () => accountAction('setup-git', { host: account?.host }));
    document.getElementById('github-repository-filter')?.addEventListener('input', (event) => { filter = event.target.value; render(); });
    document.getElementById('github-repository')?.addEventListener('change', (event) => save({ repository: event.target.value }));
    document.getElementById('github-save')?.addEventListener('click', () => save({ repository: document.getElementById('github-repository')?.value || '', baseBranch: document.getElementById('github-base-branch')?.value || '' }));
    document.getElementById('github-refresh')?.addEventListener('click', () => refresh(true));
    if (typeof technical !== 'undefined') {
      technical = state.technicalDetails || {};
      const details = document.getElementById('technical-details');
      if (details) details.textContent = JSON.stringify(technical, null, 2);
    }
  }

  async function syncShell() {
    const latest = await api('/api/setup/session');
    if (typeof store !== 'undefined') store = latest;
    if (typeof render === 'function') render();
  }
  async function save(values) {
    if (loading) return;
    loading = true;
    try { state = await api('/api/setup/github/save', { method: 'POST', body: JSON.stringify(values) }); await syncShell(); render(); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function accountAction(action, values = {}) {
    if (loading) return;
    loading = true;
    try {
      const response = await api('/api/setup/github/account', { method: 'POST', body: JSON.stringify({ action, ...values }) });
      state = response.status;
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function refresh(force = false) {
    if (!onPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try {
      state = await api(force ? '/api/setup/github/recheck' : '/api/setup/github/status', { method: force ? 'POST' : 'GET', body: force ? '{}' : undefined });
      if (force) await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }

  const observer = new MutationObserver(() => { if (onPage() && content() && !content().querySelector('#github-repository')) refresh(false); });
  const title = document.getElementById('page-title'); if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content(); if (root) observer.observe(root, { childList: true });
  document.getElementById('recheck')?.addEventListener('click', (event) => { if (!onPage()) return; event.preventDefault(); event.stopImmediatePropagation(); refresh(true); }, true);
  addEventListener('popstate', () => { if (onPage()) refresh(false); });
  if (onPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithGitHubPage(html) {
  const script = `<script data-setup-github-page>${GITHUB_PAGE_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
