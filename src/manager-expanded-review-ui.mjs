export const MANAGER_EXPANDED_REVIEW_STYLE = String.raw`
.expanded-review-details-card{margin-top:12px;border:1px solid #2d394b;border-radius:10px;background:#101720;padding:13px}.expanded-review-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.expanded-review-head h3{margin:0;color:#dce8fb;font-size:12px}.expanded-review-head h3 span{color:#8d9db1;font-weight:500}.expanded-review-type{padding:4px 8px;border:1px solid #4d3e68;border-radius:7px;background:#211b31;color:#ba9ce8;font-size:10px;font-weight:750}.expanded-review-body{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(220px,.8fr);gap:18px}.expanded-review-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}.expanded-review-fact span{display:block;font-size:10px;color:#718298}.expanded-review-fact strong,.expanded-review-fact a{display:block;margin-top:3px;color:#dce8fb;font-size:11px;overflow-wrap:anywhere}.expanded-review-fact a{color:#78adf8}.expanded-review-findings{border-left:1px solid #2a3648;padding-left:16px}.expanded-review-findings h4{margin:0 0 9px;font-size:11px;color:#dce8fb}.expanded-review-count{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #263143;font-size:10px}.expanded-review-count:last-of-type{border-bottom:0}.expanded-review-count span{color:#8fa0b4}.expanded-review-count strong{color:#dce8fb}.expanded-review-count.blocking strong{color:#e59aa5}.expanded-review-count.nonblocking strong{color:#84b7f4}.expanded-review-summary{margin-top:10px;color:#9dacbf;font-size:10px;line-height:1.45;overflow-wrap:anywhere}.expanded-review-unstructured{padding:8px 9px;border:1px solid #344153;border-radius:8px;background:#0e1620;color:#8fa0b4;font-size:10px;line-height:1.4}.expanded-review-handoff{display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 9px;border:1px solid #66562f;border-radius:8px;background:#241f14;color:#d6b765;font-size:10px}.expanded-review-handoff strong{color:#ead49a}
.review-evidence-card{margin-top:12px;border:1px solid #2d394b;border-radius:10px;background:#101720;padding:13px}.review-evidence-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.review-evidence-head h3{margin:0;color:#dce8fb;font-size:12px}.review-evidence-head h3 span{color:#8d9db1;font-weight:500}.review-evidence-updated{color:#718298;font-size:9px;white-space:nowrap}.review-evidence-copy{margin:8px 0 0;color:#9dacbf;font-size:10px;line-height:1.5}.review-evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px}.review-evidence-metric{border:1px solid #2b394d;border-radius:8px;background:#0e1620;padding:8px}.review-evidence-metric span{display:block;color:#718298;font-size:9px}.review-evidence-metric strong{display:block;margin-top:3px;color:#dce8fb;font-size:10px;overflow-wrap:anywhere}.review-evidence-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}.review-evidence-links a{color:#69a8ff;text-decoration:none;font-size:10px;font-weight:700}.review-evidence-links a:hover{text-decoration:underline}.review-finding-list{display:grid;gap:7px;margin-top:11px}.review-finding{border:1px solid #2c394a;border-radius:8px;background:#0e1620;padding:9px}.review-finding.blocking{border-color:#5f3841}.review-finding-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.review-finding-head strong{font-size:10px;color:#dce8fb}.review-finding.blocking .review-finding-head strong{color:#e59aa5}.review-finding-head span{font-size:9px;color:#718298}.review-finding p{margin:5px 0 0;color:#9dacbf;font-size:10px;line-height:1.4}.review-finding small{display:block;margin-top:5px;color:#718298;font-size:9px;line-height:1.35}
@media(max-width:760px){.expanded-review-body{grid-template-columns:1fr}.expanded-review-findings{border-left:0;border-top:1px solid #2a3648;padding:12px 0 0}.review-evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.expanded-review-head,.review-evidence-head{align-items:flex-start}.expanded-review-facts,.review-evidence-grid{grid-template-columns:1fr}}
`;

export const MANAGER_EXPANDED_REVIEW_SCRIPT = String.raw`
(function managerExpandedReviewUi() {
  let observer = null;

  function status() {
    try { return typeof currentStatus !== 'undefined' ? currentStatus : null; } catch { return null; }
  }

  function itemFor(issueNumber) {
    return status()?.workQueue?.items?.find(function(item) { return Number(item.issueNumber) === Number(issueNumber); }) || null;
  }

  function evidenceFor(issueNumber) {
    return status()?.workQueue?.reviewEvidence?.byIssue?.[String(issueNumber)] || null;
  }

  function value(value) { return value == null || value === '' ? 'Not recorded' : String(value); }
  function formatDate(input) { if (!input) return 'Not recorded'; const date = new Date(input); return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function roundLabel(evidence) { return evidence?.round ? (evidence.limit ? evidence.round + ' of ' + evidence.limit : String(evidence.round)) : 'Not recorded'; }

  function fact(label, result, href) {
    const root = document.createElement('div'); root.className = 'expanded-review-fact';
    const name = document.createElement('span'); name.textContent = label;
    const output = href ? document.createElement('a') : document.createElement('strong'); output.textContent = value(result);
    if (href) { output.href = href; output.target = '_blank'; output.rel = 'noreferrer'; }
    root.append(name, output); return root;
  }

  function currentStatusLabel(evidence) {
    const job = String(evidence?.jobState || '').toLowerCase();
    if (job === 'queued') return 'Queued';
    if (job === 'submitting') return 'Starting review';
    if (job === 'awaiting_result') return evidence.type === 'web-chatgpt' ? 'Browser review active' : 'Review in progress';
    if (job === 'completed') return evidence.result || 'Completed';
    if (job === 'failed') return 'Review failed';
    if (evidence?.result) return evidence.result;
    return evidence?.managedState || 'Recorded';
  }

  function findingSummary(evidence) {
    const root = document.createElement('div'); root.className = 'expanded-review-findings';
    const heading = document.createElement('h4'); heading.textContent = 'Findings Summary'; root.append(heading);
    if (evidence.structuredFindings) {
      const rows = [
        ['Blocking', evidence.findingCounts?.blocking || 0, 'blocking'],
        ['Non-blocking', evidence.findingCounts?.nonBlocking || 0, 'nonblocking'],
        ['Total findings', evidence.findingCounts?.total || 0, 'total'],
      ];
      for (const row of rows) {
        const line = document.createElement('div'); line.className = 'expanded-review-count ' + row[2]; const label = document.createElement('span'); label.textContent = row[0]; const count = document.createElement('strong'); count.textContent = String(row[1]); line.append(label, count); root.append(line);
      }
    } else {
      const note = document.createElement('div'); note.className = 'expanded-review-unstructured'; note.textContent = 'Structured finding counts are not recorded for this exact review head. Paseo will not infer severity counts from prose.'; root.append(note);
    }
    if (evidence.summary) { const summary = document.createElement('div'); summary.className = 'expanded-review-summary'; summary.textContent = evidence.summary; root.append(summary); }
    return root;
  }

  function reviewDetailsCard(item, evidence) {
    const card = document.createElement('section'); card.className = 'lifecycle-detail-card expanded-review-details-card'; card.dataset.expandedReviewDetails = 'true';
    const head = document.createElement('div'); head.className = 'expanded-review-head';
    const heading = document.createElement('h3'); heading.textContent = 'Review Details'; const subtype = document.createElement('span'); subtype.textContent = ' — ' + evidence.label; heading.append(subtype);
    const badge = document.createElement('span'); badge.className = 'expanded-review-type'; badge.textContent = evidence.label; head.append(heading, badge);
    const body = document.createElement('div'); body.className = 'expanded-review-body';
    const facts = document.createElement('div'); facts.className = 'expanded-review-facts';
    facts.append(fact('Review type', evidence.label), fact('Review round', roundLabel(evidence)));
    if (evidence.type === 'web-chatgpt') {
      facts.append(fact('Conversation source', evidence.conversationSource || 'Web ChatGPT (Browser)'), fact('Conversation', evidence.conversationUrl ? 'Open conversation' : null, evidence.conversationUrl));
    } else {
      facts.append(fact('Model', item.review?.model), fact('Thinking', item.review?.thinking));
    }
    facts.append(
      fact('Review requested', formatDate(evidence.requestedAt)),
      fact('Review submitted', formatDate(evidence.submittedAt)),
      fact('Review completed', formatDate(evidence.completedAt)),
      fact('Last activity', formatDate(evidence.lastActivityAt)),
      fact('Current status', currentStatusLabel(evidence)),
      fact('Exact head', evidence.exactHeadSha),
    );
    body.append(facts, findingSummary(evidence)); card.append(head, body);
    if (evidence.handoff) { const handoff = document.createElement('div'); handoff.className = 'expanded-review-handoff'; const title = document.createElement('strong'); title.textContent = 'Escalated from Light Review'; const copy = document.createElement('span'); copy.textContent = evidence.handoff.unresolvedCount + ' recorded unresolved finding' + (evidence.handoff.unresolvedCount === 1 ? '' : 's') + ' handed to the full review.'; handoff.append(title, copy); card.append(handoff); }
    return card;
  }

  function evidenceMetric(label, result) {
    const root = document.createElement('div'); root.className = 'review-evidence-metric'; const name = document.createElement('span'); name.textContent = label; const output = document.createElement('strong'); output.textContent = value(result); root.append(name, output); return root;
  }

  function findingCard(finding) {
    const root = document.createElement('article'); root.className = 'review-finding ' + (finding.severity === 'blocking' ? 'blocking' : 'nonblocking');
    const head = document.createElement('div'); head.className = 'review-finding-head'; const severity = document.createElement('strong'); severity.textContent = finding.severity === 'blocking' ? 'Blocking' : 'Non-blocking'; const location = document.createElement('span'); location.textContent = finding.file ? finding.file + (finding.line ? ':' + finding.line : '') : 'General'; head.append(severity, location);
    const message = document.createElement('p'); message.textContent = finding.message; root.append(head, message);
    const requirements = [finding.requiredChange ? 'Required change: ' + finding.requiredChange : null, finding.requiredTest ? 'Required test: ' + finding.requiredTest : null].filter(Boolean).join(' · ');
    if (requirements) { const small = document.createElement('small'); small.textContent = requirements; root.append(small); }
    return root;
  }

  function evidenceCard(evidence) {
    const card = document.createElement('section'); card.className = 'review-evidence-card'; card.dataset.reviewEvidenceCard = 'true';
    const head = document.createElement('div'); head.className = 'review-evidence-head';
    const heading = document.createElement('h3'); heading.textContent = 'Review Evidence'; const subtitle = document.createElement('span'); subtitle.textContent = evidence.type === 'web-chatgpt' ? ' — Conversation Summary' : ' — Structured Review Result'; heading.append(subtitle);
    const updated = document.createElement('span'); updated.className = 'review-evidence-updated'; updated.textContent = 'Last activity ' + formatDate(evidence.lastActivityAt); head.append(heading, updated); card.append(head);
    const copy = document.createElement('p'); copy.className = 'review-evidence-copy';
    copy.textContent = evidence.type === 'web-chatgpt'
      ? 'Paseo records the browser review job, conversation identity, exact PR head, and structured final review evidence. Transcript message counts, pages reviewed, and similar browser metrics are not invented or displayed unless Paseo actually records them.'
      : 'This panel shows only review evidence recorded by Paseo for the exact current PR head.';
    card.append(copy);
    const grid = document.createElement('div'); grid.className = 'review-evidence-grid';
    grid.append(
      evidenceMetric('Review job', evidence.jobId),
      evidenceMetric('Review request', evidence.reviewRequestId),
      evidenceMetric('Prompt version', evidence.promptVersion),
      evidenceMetric('Exact head', evidence.exactHeadSha),
      evidenceMetric('Result source', evidence.resultSourceId),
      evidenceMetric('Attempts', evidence.attempts),
    );
    card.append(grid);
    if (evidence.summary) { const summary = document.createElement('div'); summary.className = 'expanded-review-summary'; summary.textContent = evidence.summary; card.append(summary); }
    if (evidence.findings?.length) { const list = document.createElement('div'); list.className = 'review-finding-list'; evidence.findings.forEach(function(finding) { list.append(findingCard(finding)); }); card.append(list); }
    if (evidence.conversationUrl) { const links = document.createElement('div'); links.className = 'review-evidence-links'; const link = document.createElement('a'); link.href = evidence.conversationUrl; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'Open Web ChatGPT conversation ↗'; links.append(link); card.append(links); }
    return card;
  }

  function reviewVisibleForFocus(panel) {
    const focused = panel.querySelector('.lifecycle-step.stage-focused')?.dataset.lifecycleFocus || null;
    return !focused || ['review-queued', 'reviewing'].includes(focused);
  }

  function enhancePanel(panel) {
    const article = panel.closest('.lifecycle-item[data-issue-number]');
    const issueNumber = Number(article?.dataset.issueNumber); if (!issueNumber) return;
    const item = itemFor(issueNumber); const evidence = evidenceFor(issueNumber);
    if (!item || !evidence || (!item.review && !evidence.jobId && !evidence.result && !evidence.handoff)) return;
    const main = panel.querySelector('.lifecycle-main'); if (!main) return;
    let details = main.querySelector('[data-expanded-review-details="true"]');
    if (!details) {
      const original = main.querySelector('.lifecycle-detail-card');
      details = reviewDetailsCard(item, evidence);
      if (original) original.replaceWith(details); else main.append(details);
    }
    let reviewEvidence = main.querySelector('[data-review-evidence-card="true"]');
    if (!reviewEvidence) { reviewEvidence = evidenceCard(evidence); details.after(reviewEvidence); }
    const visible = reviewVisibleForFocus(panel); details.hidden = !visible; reviewEvidence.hidden = !visible;
  }

  function containsLifecyclePanel(node) {
    return node?.nodeType === 1 && (node.matches?.('.lifecycle-expanded,.lifecycle-item') || node.querySelector?.('.lifecycle-expanded'));
  }

  function apply() { document.querySelectorAll('.lifecycle-expanded').forEach(enhancePanel); }

  function start() {
    apply();
    if (!observer) {
      observer = new MutationObserver(function(records) {
        if (records.some(function(record) { return [...record.addedNodes].some(containsLifecyclePanel); })) queueMicrotask(apply);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('click', function(event) { if (event.target.closest?.('[data-lifecycle-focus],.lifecycle-focus-clear')) queueMicrotask(apply); });
    document.addEventListener('keydown', function(event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.('[data-lifecycle-focus]')) queueMicrotask(apply); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
`;
