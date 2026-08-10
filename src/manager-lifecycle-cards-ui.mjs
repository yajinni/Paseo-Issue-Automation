export const MANAGER_LIFECYCLE_CARDS_STYLE = String.raw`
.lifecycle-card-shell{min-width:0}.lifecycle-card-shell[aria-busy="true"]{opacity:.8}.lifecycle-card-loading,.lifecycle-card-error{border:1px solid #30415a;border-radius:10px;background:#101720;padding:14px;color:#9dacbf;font-size:11px}.lifecycle-card-error{border-color:#6f3c47;background:#21151a;color:#d8a2aa}
.lifecycle-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start}.lifecycle-card{min-width:0;border:1px solid #30415a;border-radius:10px;background:#101720;padding:12px}.lifecycle-card.claimed,.lifecycle-card.coding{border-color:#285d42;background:#102019}.lifecycle-card.light{border-color:#655426;background:#211e14}.lifecycle-card.heavy{border-color:#514069;background:#1b1725}.lifecycle-card.chatgpt{border-color:#255c5d;background:#102021}.lifecycle-card.completed{grid-column:1/-1;border-color:#2d5e92;background:#101c29}.lifecycle-card.pending{opacity:.78}.lifecycle-card-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:7px}.lifecycle-card-title{display:flex;align-items:center;gap:7px;min-width:0}.lifecycle-card-icon{font-size:14px;line-height:1}.lifecycle-card-title h3{margin:0;color:#e5edf9;font-size:12px}.lifecycle-card-badge{flex:0 0 auto;border:1px solid #46556a;border-radius:999px;padding:2px 6px;color:#a9b8cb;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.lifecycle-card-badge.success{border-color:#316646;background:#15291d;color:#78c994}.lifecycle-card-badge.warning{border-color:#735e27;background:#2a2314;color:#e3bd62}.lifecycle-card-badge.optional{border-color:#54436a;background:#211a2b;color:#c2a8e8}.lifecycle-card-copy{margin:0 0 9px;color:#9dacbf;font-size:10px;line-height:1.45}.lifecycle-card-facts{display:grid;gap:0}.lifecycle-card-fact{display:grid;grid-template-columns:minmax(82px,.8fr) minmax(0,1.2fr);gap:8px;padding:5px 0;border-top:1px solid #273345}.lifecycle-card-fact:first-child{border-top:0}.lifecycle-card-fact span{color:#8293a9;font-size:9px}.lifecycle-card-fact strong,.lifecycle-card-fact a{min-width:0;color:#dce8fb;font-size:9px;font-weight:650;text-align:right;overflow-wrap:anywhere}.lifecycle-card-fact a{color:#71aaff;text-decoration:none}.lifecycle-card-fact a:hover{text-decoration:underline}.lifecycle-card-result{display:inline-flex!important;justify-self:end;border-radius:5px;padding:2px 5px}.lifecycle-card-result.success{background:#173321;color:#7bd096}.lifecycle-card-result.warning{background:#392d10;color:#e8c15d}.lifecycle-card-result.danger{background:#391920;color:#ee9aa7}.lifecycle-review-findings{margin-top:8px;padding-top:8px;border-top:1px solid #2a3648;color:#8fa0b4;font-size:9px;line-height:1.4}.lifecycle-review-findings strong{color:#dce8fb}.lifecycle-completed-sections{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.lifecycle-completed-section{border:1px solid #29394e;border-radius:8px;background:#0e1824;padding:9px}.lifecycle-completed-section h4{margin:0 0 6px;color:#b9c7d8;font-size:10px}.lifecycle-completed-section .lifecycle-card-fact{grid-template-columns:minmax(75px,.8fr) minmax(0,1.2fr)}.lifecycle-mini-trail{display:flex;align-items:flex-start;gap:0;margin-top:10px;padding-top:10px;border-top:1px solid #2a3c53;overflow-x:auto}.lifecycle-mini-stop{position:relative;flex:1 0 88px;min-width:88px;text-align:center;padding:16px 5px 0;color:#8fa0b4;font-size:8px}.lifecycle-mini-stop::before{content:"";position:absolute;top:4px;left:50%;width:8px;height:8px;transform:translateX(-50%);border:1px solid #4b607b;border-radius:50%;background:#101c29}.lifecycle-mini-stop::after{content:"";position:absolute;top:8px;left:calc(50% + 5px);right:calc(-50% + 5px);height:1px;background:#35516e}.lifecycle-mini-stop:last-child::after{display:none}.lifecycle-mini-stop.done::before{border-color:#4caa70;background:#173723;box-shadow:0 0 0 2px #173723}.lifecycle-mini-stop strong{display:block;color:#c8d5e6;font-size:8px}.lifecycle-mini-stop time{display:block;margin-top:3px;color:#6f8dad;font-size:8px;white-space:nowrap}
@media(max-width:1180px){.lifecycle-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.lifecycle-card.completed{grid-column:1/-1}.lifecycle-completed-sections{grid-template-columns:1fr}}
@media(max-width:900px){.lifecycle-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.lifecycle-card-grid{grid-template-columns:1fr}.lifecycle-card.completed{grid-column:auto}.lifecycle-card-fact{grid-template-columns:1fr}.lifecycle-card-fact strong,.lifecycle-card-fact a{text-align:left}.lifecycle-card-result{justify-self:start}}
`;

export const MANAGER_LIFECYCLE_CARDS_SCRIPT = String.raw`
(function managerLifecycleCardsUi() {
  const cache = new Map();
  const loading = new Map();
  let observer = null;

  function formatDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function shortSha(value) { return value ? String(value).slice(0, 12) : 'Not recorded'; }
  function display(value) { return value == null || value === '' ? 'Not recorded' : String(value); }

  function resultTone(value) {
    const text = String(value || '').toLowerCase();
    if (/pass|approved|complete|merged|closed/.test(text)) return 'success';
    if (/change|pending|waiting|stale/.test(text)) return 'warning';
    if (/fail|error|block/.test(text)) return 'danger';
    return '';
  }

  function fact(label, value, options) {
    options = options || {};
    const row = document.createElement('div'); row.className = 'lifecycle-card-fact';
    const name = document.createElement('span'); name.textContent = label;
    const output = options.href ? document.createElement('a') : document.createElement('strong');
    output.textContent = display(value);
    if (options.href) { output.href = options.href; output.target = '_blank'; output.rel = 'noreferrer'; }
    if (options.result) output.className = 'lifecycle-card-result ' + resultTone(value);
    row.append(name, output); return row;
  }

  function cardFrame(kind, title, icon, badge) {
    const card = document.createElement('section'); card.className = 'lifecycle-card ' + kind;
    const head = document.createElement('div'); head.className = 'lifecycle-card-head';
    const identity = document.createElement('div'); identity.className = 'lifecycle-card-title';
    const glyph = document.createElement('span'); glyph.className = 'lifecycle-card-icon'; glyph.textContent = icon;
    const heading = document.createElement('h3'); heading.textContent = title; identity.append(glyph, heading); head.append(identity);
    if (badge) { const tag = document.createElement('span'); tag.className = 'lifecycle-card-badge ' + (badge.tone || ''); tag.textContent = badge.text; head.append(tag); }
    const facts = document.createElement('div'); facts.className = 'lifecycle-card-facts'; card.append(head); return { card, facts };
  }

  function claimedCard(details) {
    const claimed = details.claimed || {};
    const framed = cardFrame('claimed', 'Claimed', '✓', { text: claimed.claimedAt ? 'Claimed' : 'Pending', tone: claimed.claimedAt ? 'success' : '' });
    const copy = document.createElement('p'); copy.className = 'lifecycle-card-copy'; copy.textContent = claimed.explanation || 'Paseo selected this issue for processing and placed it in the queue to be passed to a coding agent.';
    framed.facts.append(
      fact('Issue created', formatDate(claimed.issueCreatedAt)),
      fact('Claimed by Paseo', formatDate(claimed.claimedAt)),
      fact('Claimed by', claimed.claimedBy || 'Paseo Automation'),
      fact('Next step', claimed.nextStep),
    );
    framed.card.append(copy, framed.facts); return framed.card;
  }

  function codingCard(details) {
    const coding = details.coding || {};
    const status = coding.status || 'Waiting for coding agent';
    const framed = cardFrame('coding' + (status === 'Waiting for coding agent' ? ' pending' : ''), 'Coding', '</>', { text: status, tone: resultTone(status) });
    const copy = document.createElement('p'); copy.className = 'lifecycle-card-copy'; copy.textContent = status === 'Waiting for coding agent'
      ? 'The issue is claimed and waiting to be passed to a coding agent.'
      : 'The coding agent has been assigned to implement the issue.';
    framed.facts.append(
      fact('Model', coding.model),
      fact('Thinking', coding.thinking),
      fact('Harness', coding.harness),
      fact('Coding started', formatDate(coding.startedAt)),
    );
    if (coding.completedAt) framed.facts.append(fact('Coding completed', formatDate(coding.completedAt)));
    else framed.facts.append(fact('Last activity', formatDate(coding.lastActivityAt)));
    framed.facts.append(fact('Branch', coding.branch));
    framed.card.append(copy, framed.facts); return framed.card;
  }

  function reviewCopy(type) {
    if (type === 'light') return 'A lightweight automated PR review used to catch quick issues before the review process continues.';
    if (type === 'heavy') return 'A comprehensive PR review using the configured reviewer model and full-review round policy.';
    return 'An independent Web ChatGPT browser review using the recorded conversation and exact PR-head evidence.';
  }

  function reviewCard(review) {
    const kind = review.type === 'chatgpt' ? 'chatgpt' : review.type;
    const icon = review.type === 'light' ? '✦' : review.type === 'heavy' ? '♜' : '◎';
    const badge = review.performed
      ? { text: review.result || 'Performed', tone: resultTone(review.result || 'complete') }
      : { text: 'Optional', tone: 'optional' };
    const framed = cardFrame(kind + (review.performed ? '' : ' pending'), review.label, icon, badge);
    const copy = document.createElement('p'); copy.className = 'lifecycle-card-copy'; copy.textContent = reviewCopy(review.type);
    if (review.type === 'chatgpt') {
      framed.facts.append(fact('Channel', review.channel || 'Web ChatGPT (Browser)'));
      if (review.conversationUrl) framed.facts.append(fact('Conversation', 'Open conversation ↗', { href: review.conversationUrl }));
    } else {
      framed.facts.append(fact('Model', review.model), fact('Thinking', review.thinking));
    }
    framed.facts.append(
      fact('Review started', formatDate(review.startedAt)),
      fact('Review completed', formatDate(review.completedAt)),
      fact('Review round', review.round ? (review.limit ? review.round + ' of ' + review.limit : review.round) : 'Not recorded'),
      fact('Result', review.result || (review.performed ? 'Recorded' : 'Not started'), { result: true }),
    );
    if (review.exactHeadSha) framed.facts.append(fact('Exact head', shortSha(review.exactHeadSha)));
    if (review.findingCounts?.total != null) {
      framed.facts.append(
        fact('Issues found', review.findingCounts.total),
        fact('Blocking issues', review.findingCounts.blocking),
      );
    }
    if (review.summary || review.findings?.length) {
      const findings = document.createElement('div'); findings.className = 'lifecycle-review-findings';
      if (review.summary) { const summary = document.createElement('div'); summary.textContent = review.summary; findings.append(summary); }
      if (review.findings?.length) { const count = document.createElement('strong'); count.textContent = review.findings.length + ' recorded finding' + (review.findings.length === 1 ? '' : 's'); findings.append(count); }
      framed.card.append(copy, framed.facts, findings);
    } else framed.card.append(copy, framed.facts);
    return framed.card;
  }

  function completionSection(title, rows) {
    const section = document.createElement('div'); section.className = 'lifecycle-completed-section';
    const heading = document.createElement('h4'); heading.textContent = title;
    const facts = document.createElement('div'); facts.className = 'lifecycle-card-facts';
    rows.forEach(function(row) { facts.append(fact(row[0], row[1], row[2])); });
    section.append(heading, facts); return section;
  }

  function miniTrail(details) {
    const completed = details.completed || {};
    const stops = [
      ['Claimed', details.claimed?.claimedAt],
      ['Coding', details.coding?.startedAt],
      ...(details.reviews || []).map(function(review) { return [review.label, review.completedAt || review.startedAt]; }),
      ['Merged', completed.mergedAt],
      ['Closed', completed.issueClosedAt || completed.issueClosureVerifiedAt || completed.completedAt],
    ];
    const trail = document.createElement('div'); trail.className = 'lifecycle-mini-trail';
    stops.forEach(function(stop) {
      const node = document.createElement('div'); node.className = 'lifecycle-mini-stop' + (stop[1] ? ' done' : '');
      const label = document.createElement('strong'); label.textContent = stop[0];
      const at = document.createElement('time'); at.textContent = stop[1] ? formatDate(stop[1]) : 'Pending'; node.append(label, at); trail.append(node);
    });
    return trail;
  }

  function completedCard(details) {
    const completed = details.completed || {};
    const framed = cardFrame('completed' + (completed.complete ? '' : ' pending'), 'Completed', '✓', { text: completed.complete ? 'Completed' : 'In progress', tone: completed.complete ? 'success' : '' });
    const copy = document.createElement('p'); copy.className = 'lifecycle-card-copy'; copy.textContent = completed.complete
      ? 'The pull request was merged, issue closure was recorded, and Paseo completed the lifecycle.'
      : 'Merge, issue closure, and final lifecycle completion are tracked together here.';
    const sections = document.createElement('div'); sections.className = 'lifecycle-completed-sections';
    sections.append(
      completionSection('Merge information', [
        ['PR', completed.prNumber ? '#' + completed.prNumber : null, completed.prUrl ? { href: completed.prUrl } : undefined],
        ['PR merged', formatDate(completed.mergedAt)],
        ['Merge head', shortSha(completed.mergedHeadSha)],
        ['Base branch', completed.baseBranch],
      ]),
      completionSection('Issue closure', [
        ['Issue closed', formatDate(completed.issueClosedAt)],
        ['Closure verified', formatDate(completed.issueClosureVerifiedAt)],
      ]),
      completionSection('Summary', [
        ['Lifecycle started', formatDate(details.claimed?.claimedAt)],
        ['Completed', formatDate(completed.completedAt)],
        ['Final status', completed.finalStatus],
      ]),
    );
    framed.card.append(copy, sections, miniTrail(details)); return framed.card;
  }

  function renderDetails(main, details) {
    main.textContent = '';
    const shell = document.createElement('div'); shell.className = 'lifecycle-card-shell'; shell.dataset.lifecycleCards = String(details.issueNumber);
    const heading = document.createElement('h3'); heading.className = 'lifecycle-section-title'; heading.textContent = 'Lifecycle';
    const grid = document.createElement('div'); grid.className = 'lifecycle-card-grid';
    grid.append(claimedCard(details), codingCard(details));
    (details.reviews || []).forEach(function(review) { grid.append(reviewCard(review)); });
    grid.append(completedCard(details));
    shell.append(heading, grid); main.append(shell);
  }

  function renderLoading(main, issueNumber) {
    main.textContent = '';
    const shell = document.createElement('div'); shell.className = 'lifecycle-card-shell'; shell.dataset.lifecycleCards = String(issueNumber); shell.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div'); loading.className = 'lifecycle-card-loading'; loading.textContent = 'Loading lifecycle details…'; shell.append(loading); main.append(shell);
  }

  function renderError(main, issueNumber, error) {
    main.textContent = '';
    const shell = document.createElement('div'); shell.className = 'lifecycle-card-shell'; shell.dataset.lifecycleCards = String(issueNumber);
    const message = document.createElement('div'); message.className = 'lifecycle-card-error'; message.textContent = error?.message || 'Unable to load lifecycle details.'; shell.append(message); main.append(shell);
  }

  async function load(issueNumber) {
    const key = String(issueNumber);
    if (cache.has(key)) return cache.get(key);
    if (loading.has(key)) return loading.get(key);
    const promise = jsonRequest(selectedPath('issues/' + issueNumber + '/lifecycle-details'))
      .then(function(body) { const details = body.lifecycleDetails; cache.set(key, details); return details; })
      .finally(function() { loading.delete(key); });
    loading.set(key, promise); return promise;
  }

  function enhance(panel) {
    const article = panel.closest('.lifecycle-item[data-issue-number]');
    const issueNumber = Number(article?.dataset.issueNumber); if (!issueNumber) return;
    const main = panel.querySelector('.lifecycle-main'); if (!main) return;
    if (main.querySelector('[data-lifecycle-cards="' + issueNumber + '"]')) return;
    renderLoading(main, issueNumber);
    load(issueNumber).then(function(details) {
      if (!main.isConnected || Number(article?.dataset.issueNumber) !== issueNumber) return;
      renderDetails(main, details);
    }).catch(function(error) {
      if (main.isConnected) renderError(main, issueNumber, error);
    });
  }

  function apply() { document.querySelectorAll('.lifecycle-expanded').forEach(enhance); }

  function start() {
    apply();
    const list = document.getElementById('work-queue-list');
    if (!list || typeof MutationObserver === 'undefined' || observer) return;
    observer = new MutationObserver(function(records) {
      if (records.some(function(record) { return [...record.addedNodes].some(function(node) { return node?.nodeType === 1 && (node.matches?.('.lifecycle-expanded,.lifecycle-item') || node.querySelector?.('.lifecycle-expanded')); }); })) queueMicrotask(apply);
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
`;
