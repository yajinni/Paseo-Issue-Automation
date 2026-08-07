export const ISSUES_PAGE_SCRIPT = String.raw`
(function issuesSetupPage() {
  let state = null;
  let loading = false;
  const content = () => document.getElementById('page-content');
  const onPage = () => location.pathname.replace(/\/$/, '').split('/').at(-1) === 'issues';
  function escape(value) { return String(value == null ? '' : value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
  function cardClass(missing) { return 'setup-card' + (missing ? ' required-missing' : ''); }
  function labelRows() {
    const labels = state?.preview?.labels || state?.lifecycleLabels || [];
    if (!labels.length) return '<div class="notice">Label preview is not available yet.</div>';
    return '<div class="checklist">' + labels.map((label) => {
      const status = label.status || 'managed';
      const detail = label.action || label.description || '';
      return '<div class="check-row ok"><span class="check-dot">✓</span><div><strong>' + escape(label.name) + '</strong><div class="check-detail">' + escape(status + ' · ' + detail) + '</div></div></div>';
    }).join('') + '</div>';
  }
  function render() {
    if (!onPage() || !state || !content()) return;
    const s = state.selection || {};
    const preview = state.preview || {};
    const template = preview.template || {};
    const blockerCodes = (state.check?.blockers || []).map((item) => String(item.code || ''));
    const settingsMissing = blockerCodes.some((code) => /selection-mode|max-active|retries|excluded-label/.test(code));
    const previewMissing = !state.preview || blockerCodes.some((code) => /repository-required|checkout-required|preview-unavailable/.test(code));
    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="' + cardClass(settingsMissing) + '"><h3>Issue selection</h3><p>Choose which open issues Paseo may consider. Invalid issues are still rejected by the installed issue contract.</p>'
      + '<label class="choice"><input type="radio" name="issue-mode" value="recommended-labels" ' + (s.mode === 'recommended-labels' ? 'checked' : '') + '> Recommended labels <span class="muted">(default)</span></label>'
      + '<label class="choice"><input type="radio" name="issue-mode" value="all-open" ' + (s.mode === 'all-open' ? 'checked' : '') + '> All open issues</label>'
      + '<div class="notice">' + escape(state.explanations?.ordering || '') + '</div><div class="notice">' + escape(state.explanations?.dependencies || '') + '</div></section>'
      + '<section class="' + cardClass(settingsMissing) + '"><h3>Advanced options</h3>'
      + '<div class="field"><label for="issues-max-active">Maximum simultaneous issues</label><input id="issues-max-active" type="number" min="1" max="20" value="' + escape(s.maxActive ?? 1) + '"></div>'
      + '<div class="field"><label for="issues-retries">Temporary failure retries</label><input id="issues-retries" type="number" min="0" max="20" value="' + escape(s.temporaryFailureRetries ?? 3) + '"></div>'
      + '<div class="field"><label for="issues-excluded">Excluded labels</label><input id="issues-excluded" type="text" value="' + escape((s.excludedLabels || []).join(', ')) + '" placeholder="comma-separated label names"></div>'
      + '<p class="muted">Issue settings save automatically when changed.</p></section>'
      + '<section class="' + cardClass(previewMissing) + '"><h3>Managed lifecycle labels</h3><p>Missing labels are created directly through GitHub only after final confirmation. Existing matching labels are reused without silently overwriting custom metadata.</p>' + labelRows() + '</section>'
      + '<section class="' + cardClass(previewMissing) + '"><h3>Automation issue template</h3><p>' + escape(state.explanations?.template || '') + '</p><div class="notice">' + escape(template.message || 'Template preview is not available yet.') + '</div>'
      + '<p>Template path: <code>' + escape(template.path || '.github/ISSUE_TEMPLATE/automated-coding-task.md') + '</code></p>'
      + '<p>' + escape(state.explanations?.installation || '') + '</p></section></div>';
    document.querySelectorAll('input[name="issue-mode"]').forEach((input) => input.addEventListener('change', save));
    document.getElementById('issues-max-active')?.addEventListener('change', save);
    document.getElementById('issues-retries')?.addEventListener('change', save);
    document.getElementById('issues-excluded')?.addEventListener('change', save);
    if (typeof technical !== 'undefined') technical = state.technicalDetails || {};
    const details = document.getElementById('technical-details'); if (details) details.textContent = JSON.stringify(state.technicalDetails || {}, null, 2);
    const shellStatus = document.getElementById('status'); const check = state.check;
    if (shellStatus && check) { shellStatus.className = 'status ' + (check.ok ? 'ok' : 'blocked'); shellStatus.innerHTML = '<div class="status-title">' + escape(check.ok ? 'Requirements passed' : 'Needs attention') + '</div><div class="status-copy">' + escape(check.summary || '') + '</div>'; }
  }
  async function syncShell() { const latest = await api('/api/setup/session'); if (typeof store !== 'undefined') store = latest; if (typeof render === 'function') render(); }
  async function save() {
    if (loading) return; loading = true;
    try {
      const mode = document.querySelector('input[name="issue-mode"]:checked')?.value || 'recommended-labels';
      const excludedLabels = String(document.getElementById('issues-excluded')?.value || '').split(',').map((value) => value.trim()).filter(Boolean);
      state = await api('/api/setup/issues/save', { method: 'POST', body: JSON.stringify({ mode, maxActive: Number(document.getElementById('issues-max-active')?.value || 1), temporaryFailureRetries: Number(document.getElementById('issues-retries')?.value || 0), excludedLabels }) });
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function refresh(force = false) {
    if (!onPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try { state = await api(force ? '/api/setup/issues/recheck' : '/api/setup/issues/status', { method: force ? 'POST' : 'GET', body: force ? '{}' : undefined }); if (force) await syncShell(); render(); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  const observer = new MutationObserver(() => { if (onPage() && content() && !content().querySelector('input[name="issue-mode"]')) refresh(false); });
  const title = document.getElementById('page-title'); if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content(); if (root) observer.observe(root, { childList: true });
  document.getElementById('recheck')?.addEventListener('click', (event) => { if (!onPage()) return; event.preventDefault(); event.stopImmediatePropagation(); refresh(true); }, true);
  addEventListener('popstate', () => { if (onPage()) refresh(false); });
  if (onPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithIssuesPage(html) {
  const script = `<script data-setup-issues-page>${ISSUES_PAGE_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
