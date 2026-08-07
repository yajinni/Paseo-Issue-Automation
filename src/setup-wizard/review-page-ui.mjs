export const REVIEW_PAGE_SCRIPT = String.raw`
(function reviewSetupPage() {
  let state = null;
  let loading = false;
  const content = () => document.getElementById('page-content');
  const onPage = () => location.pathname.replace(/\/$/, '').split('/').at(-1) === 'review';
  function escape(value) { return String(value == null ? '' : value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
  function selectedWorkflow() { return document.querySelector('input[name="review-workflow"]:checked')?.value || state?.selection?.workflow || 'quick-manual'; }
  function autoMergeAvailable() { const workflow = selectedWorkflow(); return workflow === 'full-immediate' || workflow === 'quick-web-chatgpt'; }
  function cardClass(missing) { return 'setup-card' + (missing ? ' required-missing' : ''); }
  function profileCard() {
    if (selectedWorkflow() !== 'quick-web-chatgpt') return '';
    const profile = state?.profile || {};
    const ui = profile.ui || {};
    const ready = profile.ready === true;
    const conversation = state?.selection?.conversationUrl || '';
    const missing = !ready || !conversation;
    return '<section class="' + cardClass(missing) + '" id="chatgpt-profile-card"><h3>ChatGPT Profile</h3>'
      + '<p>The ChatGPT Profile is an isolated signed-in browser session used only for Web ChatGPT full review. Paseo never asks for or stores your ChatGPT password.</p>'
      + '<div class="checklist"><div class="check-row ' + (ready ? 'ok' : 'bad') + '"><span class="check-dot">' + (ready ? '✓' : '!') + '</span><div><strong>' + escape(ui.statusText || (ready ? 'Signed in and ready' : 'Not ready')) + '</strong><div class="check-detail">' + escape(profile.message || (ready ? 'Authenticated session, review chat, repository access, and session persistence verified.' : 'Open ChatGPT Profile, sign in if needed, choose a review chat, then Recheck.')) + '</div></div></div></div>'
      + '<div class="field"><label for="review-chat-url">PR review chat URL</label><input id="review-chat-url" type="text" autocomplete="off" value="' + escape(conversation) + '" placeholder="https://chatgpt.com/c/..."></div>'
      + '<label class="choice"><input type="radio" name="review-chat-mode" value="dedicated" ' + (state?.selection?.reviewChatMode !== 'existing' ? 'checked' : '') + '> Create/use a dedicated PR review chat — recommended</label>'
      + '<label class="choice"><input type="radio" name="review-chat-mode" value="existing" ' + (state?.selection?.reviewChatMode === 'existing' ? 'checked' : '') + '> Use an existing chat <span class="muted">(prior context may influence reviews)</span></label>'
      + '<div class="notice">For a dedicated chat, open ChatGPT Profile, create a clean chat, copy its stable URL here, and save it. Setup verifies the selected chat has a usable composer and survives closing/reopening the profile.</div>'
      + '<div class="inline-actions"><button class="action" id="review-install-chromium" type="button">Install Chromium</button><button class="action" id="review-open-profile" type="button">Open ChatGPT Profile</button><button class="action" id="review-save-chat" type="button">Save review chat</button><button class="action primary" id="review-profile-recheck" type="button">Recheck</button></div>'
      + '<p class="muted">GitHub access is verified for the selected repository using the safe review-protocol capability check. The check must not modify repository state.</p></section>';
  }
  function autoMergeControl() {
    if (!autoMergeAvailable()) return '<div class="notice">Automatic merge is unavailable for Quick → Manual review. A person must merge the coding PR after full manual review.</div>';
    const checked = state?.selection?.autoMergeApproved === true ? 'checked' : '';
    return '<label class="choice"><input id="review-auto-merge" type="checkbox" ' + checked + '> Automatically merge approved coding PRs</label>'
      + '<div class="notice">Off by default. Paseo can request GitHub auto-merge only after the exact current head has full approval, required checks pass, the configured base is still current, no findings remain, and repository policy permits merge. Paseo never bypasses checks, reviews, protections, or rulesets.</div>';
  }
  function render() {
    if (!onPage() || !state || !content()) return;
    const s = state.selection || {};
    const workflowMissing = !['quick-manual', 'quick-web-chatgpt', 'full-immediate'].includes(s.workflow);
    const roundsMissing = !Number.isInteger(Number(s.quickMaxRounds)) || Number(s.quickMaxRounds) < 1 || Number(s.quickMaxRounds) > 20
      || !Number.isInteger(Number(s.fullMaxRounds)) || Number(s.fullMaxRounds) < 1 || Number(s.fullMaxRounds) > 20;
    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="' + cardClass(workflowMissing) + '"><h3>Review workflow</h3><p>Choose the full-review path explicitly. The coding and review models were selected earlier; this page controls how review proceeds.</p>'
      + '<label class="choice"><input type="radio" name="review-workflow" value="quick-manual" ' + (s.workflow === 'quick-manual' ? 'checked' : '') + '> Quick review → Manual review</label>'
      + '<label class="choice"><input type="radio" name="review-workflow" value="quick-web-chatgpt" ' + (s.workflow === 'quick-web-chatgpt' ? 'checked' : '') + '> Quick review → Web ChatGPT full review</label>'
      + '<label class="choice"><input type="radio" name="review-workflow" value="full-immediate" ' + (s.workflow === 'full-immediate' ? 'checked' : '') + '> Full pull request review immediately</label>'
      + '<div class="notice">' + escape(state.explanations?.quick || '') + '</div></section>'
      + '<section class="' + cardClass(roundsMissing) + '"><h3>Review rounds</h3>'
      + '<div class="field"><label for="review-quick-rounds">Maximum quick-review and correction rounds</label><input id="review-quick-rounds" type="number" min="1" max="20" value="' + escape(s.quickMaxRounds ?? 3) + '"></div>'
      + '<div class="field"><label for="review-full-rounds">Maximum full-review and correction rounds</label><input id="review-full-rounds" type="number" min="1" max="20" value="' + escape(s.fullMaxRounds ?? 3) + '"></div>'
      + '<p>Initial review counts as round 1. Quick-review exhaustion hands unresolved findings to the selected full reviewer instead of stopping the PR.</p>'
      + autoMergeControl()
      + '<p class="muted">Review settings save automatically when changed.</p></section>'
      + profileCard()
      + '<section class="setup-card"><h3>Prompt previews</h3><p>Quick and full review prompts are versioned defaults. They are copyable but not editable during initial setup.</p><div class="notice">Quick prompt: focused issue/acceptance/validation check. Full prompt: broader changed-area and surrounding-code review.</div></section>'
      + '</div>';
    document.querySelectorAll('input[name="review-workflow"]').forEach((input) => input.addEventListener('change', saveSettings));
    document.getElementById('review-quick-rounds')?.addEventListener('change', saveSettings);
    document.getElementById('review-full-rounds')?.addEventListener('change', saveSettings);
    document.getElementById('review-auto-merge')?.addEventListener('change', saveSettings);
    document.getElementById('review-save-chat')?.addEventListener('click', saveChat);
    document.getElementById('review-open-profile')?.addEventListener('click', openProfile);
    document.getElementById('review-install-chromium')?.addEventListener('click', installChromium);
    document.getElementById('review-profile-recheck')?.addEventListener('click', () => refresh(true));
    if (typeof technical !== 'undefined') technical = state.technicalDetails || {};
    const details = document.getElementById('technical-details'); if (details) details.textContent = JSON.stringify(state.technicalDetails || {}, null, 2);
    const shellStatus = document.getElementById('status'); const check = state.check;
    if (shellStatus && check) { shellStatus.className = 'status ' + (check.ok ? 'ok' : 'blocked'); shellStatus.innerHTML = '<div class="status-title">' + escape(check.ok ? 'Requirements passed' : 'Needs attention') + '</div><div class="status-copy">' + escape(check.summary || '') + '</div>'; }
  }
  async function syncShell() { const latest = await api('/api/setup/session'); if (typeof store !== 'undefined') store = latest; if (typeof render === 'function') render(); }
  async function saveSettings() {
    if (loading) return; loading = true;
    try {
      state = await api('/api/setup/review/save', { method: 'POST', body: JSON.stringify({ workflow: selectedWorkflow(), quickMaxRounds: Number(document.getElementById('review-quick-rounds')?.value || 3), fullMaxRounds: Number(document.getElementById('review-full-rounds')?.value || 3), autoMergeApproved: autoMergeAvailable() && document.getElementById('review-auto-merge')?.checked === true }) });
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function saveChat() {
    if (loading) return; loading = true;
    try {
      const mode = document.querySelector('input[name="review-chat-mode"]:checked')?.value || 'dedicated';
      const conversationUrl = String(document.getElementById('review-chat-url')?.value || '').trim();
      state = await api('/api/setup/review/chat', { method: 'POST', body: JSON.stringify({ mode, conversationUrl }) });
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function openProfile() {
    try { await api('/api/setup/review/profile/open', { method: 'POST', body: '{}' }); }
    catch (error) { if (typeof showError === 'function') showError(error); }
  }
  async function installChromium() {
    if (loading) return; loading = true;
    try { await api('/api/setup/review/chromium/install', { method: 'POST', body: '{}' }); await refresh(true); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function refresh(force = false) {
    if (!onPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try { state = await api(force ? '/api/setup/review/recheck' : '/api/setup/review/status', { method: force ? 'POST' : 'GET', body: force ? '{}' : undefined }); if (force) await syncShell(); render(); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  const observer = new MutationObserver(() => { if (onPage() && content() && !content().querySelector('input[name="review-workflow"]')) refresh(false); });
  const title = document.getElementById('page-title'); if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content(); if (root) observer.observe(root, { childList: true });
  document.getElementById('recheck')?.addEventListener('click', (event) => { if (!onPage()) return; event.preventDefault(); event.stopImmediatePropagation(); refresh(true); }, true);
  addEventListener('popstate', () => { if (onPage()) refresh(false); });
  if (onPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithReviewPage(html) {
  const script = `<script data-setup-review-page>${REVIEW_PAGE_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
