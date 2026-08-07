import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CONFIG_INTEGRATION_STYLE = String.raw`
.manager-config-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-config-group{background:var(--paseo-card-alt);border:1px solid #2d394b;border-radius:12px;padding:14px}
.manager-config-group.wide{grid-column:1/-1}.manager-config-group h3{margin:0 0 5px;font-size:15px}.manager-config-group>p{margin:0 0 12px;color:var(--paseo-muted);font-size:13px;line-height:1.4}
.manager-config-group[hidden],.manager-config-fields [hidden]{display:none!important}
.manager-config-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.manager-config-fields label{display:grid;gap:5px;color:var(--paseo-muted)}
.manager-config-inline-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.manager-config-inline-status{color:var(--paseo-muted);font-size:13px;line-height:1.4}.manager-config-inline-status.error{color:#ffaca5}
.manager-paseo-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.manager-paseo-fields label{display:grid;gap:6px;color:var(--paseo-muted)}.manager-paseo-status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin-top:14px}.manager-paseo-status div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #263143;padding:8px 0}.manager-paseo-status span{color:var(--paseo-muted)}.manager-paseo-status strong{text-align:right;overflow-wrap:anywhere}.manager-paseo-ok{color:#65c987}.manager-paseo-bad{color:#ffaca5}
.manager-profile-checks{display:grid;gap:8px;margin:12px 0}.manager-profile-check{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 0;border-bottom:1px solid #253042}.manager-profile-check:last-child{border-bottom:0}.manager-profile-check-dot{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;border:1px solid #526074;font-size:11px}.manager-profile-check.ok .manager-profile-check-dot{background:#24633d;border-color:#2f8d55}.manager-profile-check.bad .manager-profile-check-dot{background:#5f302d;border-color:#98514b}.manager-profile-check-copy small{display:block;color:var(--paseo-muted);margin-top:2px}.manager-chat-url-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin-top:12px}.manager-chat-url-row label{display:grid;gap:6px;color:var(--paseo-muted)}.manager-chat-saved{color:#65c987;font-weight:700}
.manager-config-savebar{position:sticky;bottom:12px;z-index:25;margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #39485e;border-radius:11px;padding:10px 12px;background:#101720eF;backdrop-filter:blur(8px)}
.manager-config-savebar.clean{opacity:.8}.manager-config-savebar.dirty{border-color:#66572f;background:#211d12f2}.manager-config-save-copy{font-size:13px;color:var(--paseo-muted)}.manager-config-savebar.dirty .manager-config-save-copy{color:#e2cf91}
.manager-config-save-actions{display:flex;gap:8px;flex-wrap:wrap}
.manager-context-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.manager-context-grid>.wide{grid-column:1/-1}
.manager-context-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin-top:12px}.manager-context-summary div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #263143;padding:8px 0}.manager-context-summary span{color:var(--paseo-muted)}.manager-context-summary strong{text-align:right;overflow-wrap:anywhere}
.manager-context-note{margin-top:12px;padding:10px 12px;border:1px solid #334156;border-radius:9px;background:#111a26;color:var(--paseo-muted);line-height:1.45}
.manager-detail-disclosure{margin:0!important}.manager-detail-disclosure>summary{cursor:pointer;font-weight:650;color:#dce8fb}.manager-detail-disclosure-body{display:grid;gap:12px;margin-top:12px}.manager-detail-disclosure-body>.card{margin:0!important}
.manager-maintenance-summary-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
@media(max-width:760px){.manager-config-groups,.manager-context-grid,.manager-config-fields,.manager-context-summary,.manager-paseo-fields,.manager-paseo-status{grid-template-columns:1fr}.manager-config-group.wide,.manager-context-grid>.wide{grid-column:auto}.manager-config-savebar{position:static;display:block}.manager-config-save-actions{margin-top:10px}.manager-profile-check{grid-template-columns:22px minmax(0,1fr)}.manager-profile-check button{grid-column:2}.manager-chat-url-row{grid-template-columns:1fr}.manager-chat-saved{justify-self:start}}
`;

export const MANAGER_CONFIG_INTEGRATION_SCRIPT = String.raw`
(function managerConfigIntegrationMaintenance() {
  const CONFIG_GROUPS = [
    ['Paseo connection', 'Connect this repository to the Paseo daemon used for coding and review work.', []],
    ['Coder model', 'Coding model and thinking level used for issue implementation.', ['coder-model', 'coder-thinking']],
    ['Review model', 'Reviewer model and thinking level. Workflow behavior is configured separately.', ['reviewer-model', 'reviewer-thinking']],
    ['Provider/Coding Harness', 'Choose from the coding harnesses currently reported by Paseo.', ['coding-harness']],
    ['Issue processing', 'Eligibility, concurrency, retry, exclusion, and polling settings for repository issues.', ['issue-selection-mode', 'max-active', 'temporary-failure-retries', 'excluded-labels', 'poll-interval']],
    ['Review workflow', 'Review path, round limits, and optional exact-head auto-merge policy.', ['review-workflow', 'quick-review-rounds', 'full-review-rounds', 'auto-merge-approved']],
    ['ChatGPT Profile', 'Configure the isolated browser profile and review chat used by Web ChatGPT full review.', []],
    ['GitHub repository', 'Repository branch configuration.', ['base-branch']],
  ];
  const REVIEW_WORKFLOW_COPY = {
    'quick-manual': 'Light model review → Manual review',
    'quick-web-chatgpt': 'Light model review → Web ChatGPT full review',
    'full-immediate': 'I selected a heavy review model to do the job.',
  };
  let built = false;
  let baseline = null;
  let paseoState = null;
  let paseoLoading = false;
  let harnessCatalog = null;
  let harnessLoading = false;
  let chatGptState = null;
  let chatGptLoading = false;

  function cardByHeading(root, heading) {
    if (!root) return null;
    for (const card of root.querySelectorAll('section.card')) if (card.querySelector('h2')?.textContent.trim() === heading) return card;
    return null;
  }

  function configGroupByHeading(heading) {
    for (const group of document.querySelectorAll('.manager-config-group')) {
      if (group.querySelector('h3')?.textContent.trim() === heading) return group;
    }
    return null;
  }

  function fieldContainerFor(id) {
    const input = document.getElementById(id);
    if (!input) return null;
    return input.closest('label') || input;
  }

  function replaceLabelText(id, text) {
    const label = fieldContainerFor(id);
    if (!label || label.tagName !== 'LABEL') return;
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = text;
  }

  function factPair(targetId, label) {
    const root = document.getElementById(targetId);
    if (!root) return null;
    const dt = [...root.querySelectorAll('dt')].find((item) => item.textContent.trim() === label);
    return dt ? { dt, dd: dt.nextElementSibling } : null;
  }

  function activeConfigTab() {
    return document.querySelector('.manager-config-tab[aria-selected="true"]')?.dataset.configTab || null;
  }

  function syncReviewWorkflowPresentation(data = null) {
    const select = document.getElementById('review-workflow');
    if (!select) return;
    for (const option of select.options) {
      if (REVIEW_WORKFLOW_COPY[option.value]) option.textContent = REVIEW_WORKFLOW_COPY[option.value];
    }
    replaceLabelText('quick-review-rounds', 'Light model review rounds');
    replaceLabelText('full-review-rounds', 'Full review rounds');
    const workflow = select.value || data?.configuration?.review?.workflow || 'quick-manual';
    const fullField = fieldContainerFor('full-review-rounds');
    if (fullField) fullField.hidden = workflow === 'quick-manual';
    const help = document.getElementById('auto-merge-help');
    if (help && workflow === 'quick-manual') help.textContent = 'Automatic merge is unavailable for Light model review → Manual review. A person must merge the PR after manual review.';
    const setupWorkflow = factPair('setup-facts', 'Review workflow');
    if (setupWorkflow?.dd) setupWorkflow.dd.textContent = REVIEW_WORKFLOW_COPY[workflow] || workflow;
    const lightLimit = factPair('automation-facts', 'Quick review limit') || factPair('automation-facts', 'Light model review limit');
    if (lightLimit?.dt) lightLimit.dt.textContent = 'Light model review limit';
    const fullLimit = factPair('automation-facts', 'Full review limit');
    if (fullLimit?.dt) fullLimit.dt.hidden = workflow === 'quick-manual';
    if (fullLimit?.dd) fullLimit.dd.hidden = workflow === 'quick-manual';
    const profile = configGroupByHeading('ChatGPT Profile');
    if (profile) {
      const showProfile = workflow === 'quick-web-chatgpt';
      profile.dataset.configConditionalHidden = showProfile ? 'false' : 'true';
      profile.hidden = !showProfile || activeConfigTab() !== 'review';
      if (showProfile && activeConfigTab() === 'review') loadChatGptProfile();
    }
  }

  function snapshotConfigForm() {
    const form = document.getElementById('config-form');
    if (!form) return '';
    const values = [];
    for (const element of form.querySelectorAll('input,select')) {
      if (!element.id || element.dataset.managerTransient === 'true') continue;
      values.push([element.id, element.type === 'checkbox' ? element.checked : element.value]);
    }
    return JSON.stringify(values);
  }

  function validateConfigForm() {
    const errors = [];
    const integer = (id, min, max, label) => {
      const value = Number(document.getElementById(id)?.value);
      if (!Number.isInteger(value) || value < min || value > max) errors.push(label + ' must be ' + min + '–' + max + '.');
    };
    if (!String(document.getElementById('base-branch')?.value || '').trim()) errors.push('Base branch is required.');
    if (!String(document.getElementById('coding-harness')?.value || '').trim()) errors.push('Provider/Coding Harness is required.');
    integer('poll-interval', 60, 3600, 'Poll interval');
    integer('max-active', 1, 20, 'Maximum active issues');
    integer('temporary-failure-retries', 0, 20, 'Transient failure retries');
    integer('quick-review-rounds', 1, 20, 'Light model review rounds');
    integer('full-review-rounds', 1, 20, 'Full review rounds');
    return errors;
  }

  function renderDirtyState() {
    const bar = document.getElementById('manager-config-savebar');
    const copy = document.getElementById('manager-config-save-copy');
    const save = document.getElementById('manager-config-save');
    const discard = document.getElementById('manager-config-discard');
    if (!bar || !copy || !save || !discard) return;
    const dirty = baseline !== null && snapshotConfigForm() !== baseline;
    const errors = validateConfigForm();
    bar.classList.toggle('dirty', dirty);
    bar.classList.toggle('clean', !dirty);
    copy.textContent = errors.length ? errors[0] : dirty ? 'Unsaved configuration changes.' : 'Configuration matches the last server status.';
    save.disabled = !dirty || errors.length > 0;
    discard.disabled = !dirty;
  }

  function paseoSummaryRow(target, label, value) {
    const row = document.createElement('div');
    const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = value == null || value === '' ? 'Unknown' : String(value);
    row.append(name, result); target.append(row);
  }

  function renderPaseoConnection(errorMessage = null) {
    const target = document.getElementById('manager-paseo-connection');
    if (!target) return;
    const existingHost = document.getElementById('manager-paseo-host')?.value || paseoState?.host || '';
    target.textContent = '';
    const fields = document.createElement('div'); fields.className = 'manager-paseo-fields';
    const hostLabel = document.createElement('label'); hostLabel.textContent = 'Paseo host';
    const host = document.createElement('input'); host.id = 'manager-paseo-host'; host.type = 'text'; host.placeholder = '127.0.0.1:6767'; host.value = existingHost; host.dataset.managerTransient = 'true'; hostLabel.append(host);
    const passwordLabel = document.createElement('label'); passwordLabel.textContent = 'Paseo password (only if configured)';
    const password = document.createElement('input'); password.id = 'manager-paseo-password'; password.type = 'password'; password.autocomplete = 'off'; password.dataset.managerTransient = 'true'; passwordLabel.append(password);
    fields.append(hostLabel, passwordLabel); target.append(fields);

    const actions = document.createElement('div'); actions.className = 'manager-config-inline-actions';
    const connect = document.createElement('button'); connect.type = 'button'; connect.className = 'primary'; connect.id = 'manager-connect-paseo'; connect.textContent = 'Connect & check'; connect.disabled = paseoLoading;
    const recheck = document.createElement('button'); recheck.type = 'button'; recheck.className = 'secondary'; recheck.id = 'manager-recheck-paseo'; recheck.textContent = 'Check again'; recheck.disabled = paseoLoading;
    const state = document.createElement('span'); state.className = 'manager-config-inline-status ' + (errorMessage || paseoState && !paseoState.ok ? 'error' : '');
    state.textContent = errorMessage || (paseoLoading ? 'Checking Paseo…' : paseoState?.ok ? 'Paseo connection is ready.' : paseoState?.diagnostic || 'Paseo has not been checked yet.');
    actions.append(connect, recheck, state); target.append(actions);

    if (paseoState) {
      const summary = document.createElement('div'); summary.className = 'manager-paseo-status';
      paseoSummaryRow(summary, 'Connection', paseoState.ok ? 'Ready' : 'Needs attention');
      paseoSummaryRow(summary, 'Source', paseoState.source || 'Unknown');
      paseoSummaryRow(summary, 'CLI', paseoState.cli?.path || paseoState.cli?.resolvedCommand || (paseoState.cli?.ok ? 'Available' : 'Unavailable'));
      paseoSummaryRow(summary, 'Daemon', paseoState.daemon?.reachable ? (paseoState.daemon?.version || 'Reachable') : 'Not reachable');
      paseoSummaryRow(summary, 'Authentication', paseoState.authentication?.required ? (paseoState.authentication?.ok ? 'Accepted' : 'Required') : 'Not required');
      paseoSummaryRow(summary, 'Compatibility', paseoState.compatibility?.ok ? 'Compatible' : paseoState.compatibility?.reason || 'Not verified');
      target.append(summary);
    }
    connect.addEventListener('click', connectPaseo);
    recheck.addEventListener('click', () => loadPaseoConnection(true));
  }

  async function loadPaseoConnection(force = false) {
    if (paseoLoading || paseoState && !force) { renderPaseoConnection(); return; }
    paseoLoading = true; renderPaseoConnection();
    try {
      const body = await jsonRequest(selectedPath('configuration/paseo-connection'));
      paseoState = body.status || null;
      if (paseoState?.ok) harnessCatalog = null;
      renderPaseoConnection();
    } catch (error) {
      renderPaseoConnection(error.message || String(error));
    } finally { paseoLoading = false; renderPaseoConnection(); }
  }

  async function connectPaseo() {
    if (paseoLoading) return;
    const host = String(document.getElementById('manager-paseo-host')?.value || '').trim();
    const password = String(document.getElementById('manager-paseo-password')?.value || '');
    paseoLoading = true; renderPaseoConnection();
    try {
      const body = await jsonRequest(selectedPath('configuration/paseo-connection/connect'), {
        method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ host, password, remember: true }),
      });
      paseoState = body.status || null;
      harnessCatalog = null;
      renderPaseoConnection();
    } catch (error) {
      renderPaseoConnection(error.message || String(error));
    } finally { paseoLoading = false; renderPaseoConnection(); }
  }

  function ensureHarnessSelect() {
    const existing = document.getElementById('coding-harness');
    if (!existing || existing.tagName === 'SELECT') return existing;
    const select = document.createElement('select');
    select.id = existing.id;
    select.setAttribute('aria-label', 'Provider/Coding Harness');
    const current = String(existing.value || '').trim();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a Paseo coding harness';
    select.append(placeholder);
    if (current) {
      const option = document.createElement('option'); option.value = current; option.textContent = current; select.append(option); select.value = current;
    }
    existing.replaceWith(select);
    return select;
  }

  function ensureHarnessCurrentOption(value) {
    const select = document.getElementById('coding-harness');
    const current = String(value || '').trim();
    if (!select || select.tagName !== 'SELECT' || !current) return;
    if (![...select.options].some((option) => option.value === current)) {
      const option = document.createElement('option'); option.value = current; option.textContent = current + ' (currently configured)'; select.append(option);
    }
    select.value = current;
  }

  function renderHarnessCatalog() {
    const select = document.getElementById('coding-harness');
    const status = document.getElementById('manager-harness-status');
    if (!select || !status || !harnessCatalog) return;
    const current = String(select.value || currentStatus?.configuration?.codingHarness || '').trim();
    select.textContent = '';
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a Paseo coding harness'; select.append(placeholder);
    for (const provider of harnessCatalog.catalog?.providers || []) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.label || provider.id;
      select.append(option);
    }
    if (current && ![...select.options].some((option) => option.value === current)) {
      const option = document.createElement('option'); option.value = current; option.textContent = current + ' (currently configured; not reported by Paseo)'; select.append(option);
    }
    select.value = current;
    const count = harnessCatalog.catalog?.providers?.length || 0;
    status.className = 'manager-config-inline-status';
    status.textContent = 'Found ' + count + ' coding harness' + (count === 1 ? '' : 'es') + ' from Paseo at ' + harnessCatalog.host + '.';
    renderDirtyState();
  }

  async function loadHarnessCatalog(force = false) {
    if (harnessLoading || harnessCatalog && !force) { renderHarnessCatalog(); return; }
    const status = document.getElementById('manager-harness-status');
    if (status) { status.className = 'manager-config-inline-status'; status.textContent = 'Checking available coding harnesses in Paseo…'; }
    harnessLoading = true;
    try {
      harnessCatalog = await jsonRequest(selectedPath('configuration/harnesses'));
      renderHarnessCatalog();
    } catch (error) {
      if (status) { status.className = 'manager-config-inline-status error'; status.textContent = error.message || String(error); }
    } finally { harnessLoading = false; }
  }

  function addHarnessTools(group) {
    const actions = document.createElement('div'); actions.className = 'manager-config-inline-actions';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'secondary'; refresh.id = 'manager-refresh-harnesses'; refresh.textContent = 'Refresh available harnesses';
    const status = document.createElement('span'); status.id = 'manager-harness-status'; status.className = 'manager-config-inline-status'; status.textContent = 'Open this tab to check the coding harnesses Paseo currently provides.';
    refresh.addEventListener('click', () => loadHarnessCatalog(true));
    actions.append(refresh, status); group.append(actions);
  }

  function addPaseoTools(group) {
    group.dataset.configStepGroup = 'paseo';
    const target = document.createElement('div'); target.id = 'manager-paseo-connection'; group.append(target);
    renderPaseoConnection();
  }

  function profileCheck(target, label, ready, buttonText, buttonId, disabled = false) {
    const row = document.createElement('div'); row.className = 'manager-profile-check ' + (ready ? 'ok' : 'bad');
    const dot = document.createElement('span'); dot.className = 'manager-profile-check-dot'; dot.textContent = ready ? '✓' : '!';
    const copy = document.createElement('div'); copy.className = 'manager-profile-check-copy';
    const strong = document.createElement('strong'); strong.textContent = label;
    const detail = document.createElement('small'); detail.textContent = ready ? 'Installed and ready.' : 'Not installed.';
    copy.append(strong, detail); row.append(dot, copy);
    if (!ready && buttonText) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.id = buttonId; button.textContent = buttonText; button.disabled = disabled; row.append(button);
    }
    target.append(row);
  }

  function renderChatGptProfile() {
    const target = document.getElementById('manager-chatgpt-profile');
    if (!target) return;
    target.textContent = '';
    if (!chatGptState) {
      const loading = document.createElement('div'); loading.className = 'manager-config-inline-status'; loading.textContent = chatGptLoading ? 'Checking ChatGPT Profile prerequisites…' : 'Open this tab to load ChatGPT Profile settings.'; target.append(loading); return;
    }
    const playwrightReady = chatGptState.libraryInstalled === true;
    const chromiumReady = chatGptState.chromiumInstalled === true;
    const browserReady = playwrightReady && chromiumReady;
    const checks = document.createElement('div'); checks.className = 'manager-profile-checks';
    profileCheck(checks, 'Playwright', playwrightReady, 'Install Playwright', 'manager-install-playwright');
    profileCheck(checks, 'Chromium', chromiumReady, 'Install Chromium', 'manager-install-chromium', !playwrightReady);
    target.append(checks);

    const actions = document.createElement('div'); actions.className = 'manager-config-inline-actions';
    const login = document.createElement('button'); login.type = 'button'; login.className = 'secondary'; login.id = 'manager-open-chatgpt-profile'; login.textContent = 'Log into ChatGPT Profile'; login.disabled = !browserReady;
    actions.append(login); target.append(actions);

    const note = document.createElement('div'); note.className = 'manager-context-note'; note.textContent = 'Use the isolated ChatGPT Profile for Web ChatGPT full review. Log in if needed, open or create the review chat, paste its stable URL below, and close Chromium when you are finished.'; target.append(note);

    const row = document.createElement('div'); row.className = 'manager-chat-url-row';
    const label = document.createElement('label'); label.textContent = 'PR review chat URL';
    const input = document.createElement('input'); input.id = 'manager-review-chat-url'; input.type = 'text'; input.autocomplete = 'off'; input.placeholder = 'https://chatgpt.com/c/...'; input.value = chatGptState.conversationUrl || ''; input.dataset.managerTransient = 'true';
    label.append(input);
    const saved = document.createElement('span'); saved.id = 'manager-review-chat-saved'; saved.className = 'manager-chat-saved'; saved.textContent = 'Saved'; saved.hidden = !chatGptState.conversationUrl;
    row.append(label, saved); target.append(row);

    document.getElementById('manager-install-playwright')?.addEventListener('click', () => runChatGptAction('configuration/chatgpt-profile/playwright/install'));
    document.getElementById('manager-install-chromium')?.addEventListener('click', () => runChatGptAction('configuration/chatgpt-profile/chromium/install'));
    login.addEventListener('click', () => runChatGptAction('configuration/chatgpt-profile/open', false));
    input.addEventListener('input', () => { saved.hidden = true; });
    input.addEventListener('change', saveChatGptUrl);
  }

  async function loadChatGptProfile(force = false) {
    if (chatGptLoading || chatGptState && !force) { renderChatGptProfile(); return; }
    chatGptLoading = true; renderChatGptProfile();
    try {
      const body = await jsonRequest(selectedPath('configuration/chatgpt-profile'));
      chatGptState = body.status || null;
    } catch (error) {
      chatGptState = { error: error.message || String(error), libraryInstalled: false, chromiumInstalled: false, conversationUrl: null };
    } finally { chatGptLoading = false; renderChatGptProfile(); }
  }

  async function runChatGptAction(action, refresh = true) {
    if (chatGptLoading) return;
    chatGptLoading = true;
    try {
      const body = await jsonRequest(selectedPath(action), { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
      if (refresh) chatGptState = body.status || chatGptState;
    } catch (error) {
      const target = document.getElementById('manager-chatgpt-profile');
      if (target) { const message = document.createElement('div'); message.className = 'manager-config-inline-status error'; message.textContent = error.message || String(error); target.prepend(message); }
    } finally { chatGptLoading = false; if (refresh) renderChatGptProfile(); }
  }

  async function saveChatGptUrl() {
    const input = document.getElementById('manager-review-chat-url');
    if (!input || chatGptLoading) return;
    const conversationUrl = String(input.value || '').trim();
    if (!conversationUrl || conversationUrl === String(chatGptState?.conversationUrl || '')) { renderChatGptProfile(); return; }
    chatGptLoading = true;
    try {
      const body = await jsonRequest(selectedPath('configuration/chatgpt-profile/chat'), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ conversationUrl }) });
      chatGptState = body.status || { ...chatGptState, conversationUrl: body.conversationUrl || conversationUrl };
    } catch (error) {
      const saved = document.getElementById('manager-review-chat-saved'); if (saved) saved.hidden = true;
      showError(error);
    } finally { chatGptLoading = false; renderChatGptProfile(); }
  }

  function buildConfiguration() {
    const view = document.querySelector('[data-manager-view="configuration"]');
    const existing = cardByHeading(view, 'Configuration');
    const form = document.getElementById('config-form');
    if (!view || !existing || !form) return;
    existing.querySelector('h2').textContent = 'Repository configuration';
    ensureHarnessSelect();
    const oldGrid = form.querySelector('.field-grid');
    const groups = document.createElement('div'); groups.className = 'manager-config-groups';
    for (const [title, description, ids] of CONFIG_GROUPS) {
      const group = document.createElement('section'); group.className = 'manager-config-group';
      if (['Paseo connection', 'Provider/Coding Harness', 'Review workflow', 'ChatGPT Profile', 'GitHub repository'].includes(title)) group.classList.add('wide');
      const h3 = document.createElement('h3'); h3.textContent = title;
      const copy = document.createElement('p'); copy.textContent = description;
      const fields = document.createElement('div'); fields.className = 'manager-config-fields';
      for (const id of ids) {
        const field = fieldContainerFor(id);
        if (field) fields.append(field);
      }
      if (title === 'Review workflow') {
        const help = document.getElementById('auto-merge-help');
        if (help) fields.append(help);
      }
      group.append(h3, copy);
      if (ids.length || title === 'Review workflow') group.append(fields);
      if (title === 'Paseo connection') addPaseoTools(group);
      if (title === 'Provider/Coding Harness') addHarnessTools(group);
      if (title === 'ChatGPT Profile') {
        group.dataset.configConditionalHidden = 'true';
        const profile = document.createElement('div'); profile.id = 'manager-chatgpt-profile'; group.append(profile);
      }
      groups.append(group);
    }
    oldGrid?.replaceWith(groups);

    const existingActions = form.querySelector('.actions');
    const submit = existingActions?.querySelector('button[type="submit"]');
    const savebar = document.createElement('div'); savebar.id = 'manager-config-savebar'; savebar.className = 'manager-config-savebar clean';
    const saveCopy = document.createElement('div'); saveCopy.id = 'manager-config-save-copy'; saveCopy.className = 'manager-config-save-copy'; saveCopy.textContent = 'Configuration matches the last server status.';
    const actions = document.createElement('div'); actions.className = 'manager-config-save-actions';
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'secondary'; discard.id = 'manager-config-discard'; discard.textContent = 'Discard changes';
    if (submit) { submit.id = 'manager-config-save'; submit.textContent = 'Save configuration'; actions.append(discard, submit); }
    savebar.append(saveCopy, actions); existingActions?.replaceWith(savebar);
    form.addEventListener('input', renderDirtyState);
    form.addEventListener('change', renderDirtyState);
    document.getElementById('review-workflow')?.addEventListener('change', () => syncReviewWorkflowPresentation());
    discard.addEventListener('click', () => { try { if (typeof currentStatus !== 'undefined' && currentStatus) window.renderStatus(currentStatus); } catch {} });
    syncReviewWorkflowPresentation();
  }

  function summaryRow(target, label, value) {
    const row = document.createElement('div'); const name = document.createElement('span'); const result = document.createElement('strong');
    name.textContent = label; result.textContent = value == null || value === '' ? 'None' : String(value); row.append(name, result); target.append(row);
  }

  function buildIntegration() {
    const view = document.querySelector('[data-manager-view="integration"]');
    if (!view) return;
    const repository = cardByHeading(view, 'Repository');
    const setup = cardByHeading(view, 'Setup');
    const integration = cardByHeading(view, 'Repository integration');
    const summary = document.createElement('section'); summary.className = 'card'; summary.id = 'manager-integration-summary-card';
    summary.innerHTML = '<h2>Integration summary</h2><p class="muted">Repository ownership, controller mode, setup state, and managed changes at a glance.</p><div id="manager-integration-summary" class="manager-context-summary"></div>';
    const note = document.createElement('div'); note.className = 'manager-context-note'; note.textContent = 'Integration actions only change manager-owned components. Embedded migration and removal continue to use reviewed pull requests before local ownership state changes.'; summary.append(note);
    if (integration) integration.querySelector('h2').textContent = 'Managed repository integration';
    const details = document.createElement('details'); details.className = 'card manager-detail-disclosure';
    const detailSummary = document.createElement('summary'); detailSummary.textContent = 'Repository and setup technical details';
    const body = document.createElement('div'); body.className = 'manager-detail-disclosure-body';
    if (repository) body.append(repository); if (setup) body.append(setup); details.append(detailSummary, body);
    view.prepend(summary);
    view.append(details);
  }

  function buildMaintenance() {
    const view = document.querySelector('[data-manager-view="maintenance"]');
    if (!view) return;
    const summary = document.createElement('section'); summary.className = 'card'; summary.id = 'manager-maintenance-summary-card';
    summary.innerHTML = '<h2>Health & recovery</h2><p class="muted">Current blockers and safe recovery paths for the selected repository.</p><div id="manager-maintenance-summary" class="manager-context-summary"></div>';
    view.prepend(summary);
    const registration = view.querySelector('[data-manager-manual-registration]');
    if (registration) registration.classList.add('manager-detail-disclosure');
  }

  function renderIntegration(data) {
    const target = document.getElementById('manager-integration-summary');
    if (!target) return;
    const setup = data.setup || {};
    const changes = setup.repositoryChanges || {};
    target.textContent = '';
    summaryRow(target, 'Controller mode', setup.externalController ? 'Standalone manager' : setup.embeddedController ? 'Embedded repository' : 'Not installed');
    summaryRow(target, 'Setup complete', setup.complete ? 'Yes' : 'No');
    summaryRow(target, 'Base branch', setup.baseBranch || 'Not configured');
    summaryRow(target, 'Workspace', setup.workspaceId || 'Not configured');
    summaryRow(target, 'Managed files', (changes.managedFiles || []).length);
    summaryRow(target, 'Pending managed files', (changes.expectedFiles || []).length);
    summaryRow(target, 'Unrelated changes', (changes.unexpectedFiles || []).length);
    summaryRow(target, 'Migration', setup.migration?.state || 'Not started');
  }

  function renderMaintenance(data) {
    const target = document.getElementById('manager-maintenance-summary');
    if (!target) return;
    const operational = data.operational || {};
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    const warnings = blockers.filter((item) => item.severity === 'warning').length;
    const errors = blockers.filter((item) => item.severity === 'error').length;
    target.textContent = '';
    summaryRow(target, 'Issue processing', operational.issueProcessing || 'Unknown');
    summaryRow(target, 'PR reviews', operational.prReviews || 'Unknown');
    summaryRow(target, 'Blocking conditions', operational.blockingCount || 0);
    summaryRow(target, 'Errors', errors);
    summaryRow(target, 'Warnings', warnings);
    summaryRow(target, 'Removal state', data.maintenance?.removal?.state || 'Not started');
  }

  function render(data) {
    if (!data) return;
    ensureHarnessCurrentOption(data.configuration?.codingHarness);
    syncReviewWorkflowPresentation(data);
    baseline = snapshotConfigForm();
    renderDirtyState();
    renderIntegration(data);
    renderMaintenance(data);
  }

  function removeSetupLinkCards() {
    for (const card of document.querySelectorAll('.manager-config-step-link')) card.remove();
  }

  function build() {
    if (built) return;
    if (!document.querySelector('[data-manager-view="configuration"]')) return;
    built = true;
    buildConfiguration(); buildIntegration(); buildMaintenance();
    removeSetupLinkCards();
    baseline = snapshotConfigForm(); renderDirtyState();
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
  }

  document.addEventListener('paseo:configuration-tab', (event) => {
    removeSetupLinkCards();
    const step = event.detail?.step;
    const savebar = document.getElementById('manager-config-savebar');
    if (savebar) savebar.style.display = step === 'paseo' ? 'none' : '';
    if (step === 'paseo') loadPaseoConnection();
    if (step === 'harness') loadHarnessCatalog();
    if (step === 'review' && document.getElementById('review-workflow')?.value === 'quick-web-chatgpt') loadChatGptProfile();
  });

  const previous = window.renderStatus;
  if (typeof previous === 'function') {
    window.renderStatus = function managerConfigIntegrationRenderStatus(data) {
      const result = previous(data);
      render(data);
      return result;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithConfigIntegrationMaintenance(html) {
  const styled = injectIntoHead(html, `<style data-manager-config-integration-style>${MANAGER_CONFIG_INTEGRATION_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-config-integration>${MANAGER_CONFIG_INTEGRATION_SCRIPT}</script>`);
}
