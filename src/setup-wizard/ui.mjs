import { SETUP_PAGE_IDS } from './store.mjs';

const PAGE_META = Object.freeze({
  paseo: { step: 1, title: 'Connect Paseo', summary: 'Find and verify the Paseo daemon and CLI.' },
  harness: { step: 2, title: 'Coding harness', summary: 'Choose the provider, coding model, and review model.' },
  repository: { step: 3, title: 'GitHub repository', summary: 'Choose the GitHub account, repository, and base branch.' },
  checkout: { step: 4, title: 'Local checkout', summary: 'Find or create a safe local checkout.' },
  workspace: { step: 5, title: 'Paseo workspace', summary: 'Register the checkout and verify isolated-worktree readiness.' },
  issues: { step: 6, title: 'Issues setup', summary: 'Choose issue eligibility and preview managed repository resources.' },
  review: { step: 7, title: 'Review setup', summary: 'Choose the review workflow and review limits.' },
  readiness: { step: 8, title: 'Final readiness', summary: 'Review setup, install approved changes, and optionally start automation.' },
});

export function setupPageIdFromPath(pathname) {
  const value = String(pathname || '').replace(/^\/setup\/?/, '').replace(/\/$/, '');
  if (!value) return null;
  return SETUP_PAGE_IDS.includes(value) ? value : undefined;
}

export function setupPagePath(pageId) {
  if (!SETUP_PAGE_IDS.includes(pageId)) throw new Error(`Unknown setup page: ${pageId}.`);
  return `/setup/${pageId}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function setupWizardHtml({ requestedPage = null } = {}) {
  const initialPage = SETUP_PAGE_IDS.includes(requestedPage) ? requestedPage : SETUP_PAGE_IDS[0];
  const pageMeta = Object.fromEntries(SETUP_PAGE_IDS.map((id) => [id, PAGE_META[id]]));
  const nav = SETUP_PAGE_IDS.map((id) => {
    const page = PAGE_META[id];
    return `<button class="step" type="button" data-page="${id}" aria-current="false"><span>${page.step}</span><strong>${escapeHtml(page.title)}</strong></button>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paseo Issue Automation setup</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#11151b;color:#eef2f7}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0d1117,#151b24);min-height:100vh}.shell{max-width:1120px;margin:0 auto;padding:24px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.topbar a{color:inherit;text-decoration:none}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#93a4b8}.topbar h1{font-size:22px;margin:4px 0 0}.dashboard-link{border:1px solid #344153;border-radius:9px;padding:9px 12px;color:#cbd5e1}.layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px}.progress,.panel{background:#171e28;border:1px solid #293445;border-radius:14px;box-shadow:0 12px 40px #0004}.progress{padding:12px}.step{width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;color:#9aabc0;text-align:left;padding:10px;border-radius:9px;cursor:pointer}.step span{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid #4a586b;font-size:12px}.step strong{font-size:13px}.step[aria-current="page"]{background:#243044;color:#fff}.step.completed span{background:#24633d;border-color:#2f8d55;color:#fff}.step:disabled{opacity:.45;cursor:not-allowed}.panel{padding:28px;min-height:540px;display:flex;flex-direction:column}.page-head{border-bottom:1px solid #293445;padding-bottom:20px}.page-head h2{font-size:28px;margin:5px 0 8px}.page-head p{color:#9fb0c5;margin:0;line-height:1.55}.status{margin:22px 0;padding:14px;border:1px solid #334156;border-radius:10px;background:#111821}.status.ok{border-color:#276b43}.status.blocked{border-color:#804844}.status-title{font-weight:700}.status-copy{margin-top:5px;color:#aab8c9}.content{flex:1}.placeholder{padding:26px 0;color:#aab8c9;line-height:1.65}.details{margin:18px 0;border-top:1px solid #293445;padding-top:14px}.details summary{cursor:pointer;color:#bbc8d7}.details pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1219;padding:12px;border-radius:9px;color:#9fb0c5;font-size:12px}.actions{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #293445;padding-top:20px}.actions .right{display:flex;gap:10px}button.action{border:1px solid #43526a;background:#222d3d;color:#eef2f7;border-radius:9px;padding:10px 14px;font-weight:650;cursor:pointer}.action.primary{background:#2f6fed;border-color:#2f6fed}.action:disabled{opacity:.45;cursor:not-allowed}.error{color:#ffaca5}.muted{color:#8797aa}@media(max-width:760px){.shell{padding:14px}.topbar{align-items:flex-start}.layout{grid-template-columns:1fr}.progress{display:flex;overflow-x:auto}.step{min-width:58px;width:auto;justify-content:center}.step strong{display:none}.panel{padding:20px;min-height:500px}.actions{position:sticky;bottom:0;background:#171e28}.dashboard-link{font-size:12px}}
</style>
</head>
<body data-requested-page="${initialPage}">
<main class="shell">
  <header class="topbar"><div><div class="eyebrow">Paseo Issue Automation</div><h1>Setup walkthrough</h1></div><a class="dashboard-link" href="/">Manager dashboard</a></header>
  <div class="layout">
    <nav class="progress" aria-label="Setup progress">${nav}</nav>
    <section class="panel" aria-live="polite">
      <header class="page-head"><div class="eyebrow" id="step-label"></div><h2 id="page-title">Loading setup…</h2><p id="page-summary"></p></header>
      <div class="content"><div id="status" class="status"><div class="status-title">Loading saved progress…</div><div class="status-copy">Setup state is stored by the standalone manager.</div></div><div id="page-content" class="placeholder"></div><details class="details"><summary>Technical details</summary><pre id="technical-details">No technical details.</pre></details></div>
      <footer class="actions"><button class="action" id="back" type="button">Back</button><div class="right"><button class="action" id="recheck" type="button">Recheck</button><button class="action primary" id="continue" type="button">Continue</button></div></footer>
    </section>
  </div>
</main>
<script>
const PAGE_IDS=${JSON.stringify(SETUP_PAGE_IDS)};
const PAGE_META=${JSON.stringify(pageMeta)};
const requestedPage=document.body.dataset.requestedPage;
let store=null;
let visiblePage=requestedPage;
let technical={};
const $=(id)=>document.getElementById(id);
async function api(path,options={}){const response=await fetch(path,{headers:{'content-type':'application/json'},...options});let body={};try{body=await response.json()}catch{}if(!response.ok){const error=new Error(body?.error?.message||body?.error||('Request failed: '+response.status));error.status=response.status;error.body=body;throw error}return body}
function active(){return store&&store.activeSession}
function permitted(page){const session=active();if(!session)return page===PAGE_IDS[0];if(page===session.currentPage)return true;return session.pages&&session.pages[page]&&session.pages[page].completed===true}
function nearestPermitted(page){if(permitted(page))return page;const session=active();return session&&PAGE_IDS.includes(session.currentPage)?session.currentPage:PAGE_IDS[0]}
function pathFor(page){return '/setup/'+page}
function showError(error){technical=error?.body||{message:error?.message||String(error)};$('status').className='status blocked';$('status').innerHTML='<div class="status-title error">Action could not complete</div><div class="status-copy"></div>';$('status').querySelector('.status-copy').textContent=error?.message||String(error);$('technical-details').textContent=JSON.stringify(technical,null,2)}
function render({replaceHistory=false}={}){const session=active();visiblePage=nearestPermitted(visiblePage);const meta=PAGE_META[visiblePage];const page=session?.pages?.[visiblePage]||{};document.querySelectorAll('.step').forEach((button)=>{const id=button.dataset.page;button.setAttribute('aria-current',id===visiblePage?'page':'false');button.classList.toggle('completed',session?.pages?.[id]?.completed===true);button.disabled=!permitted(id)});$('step-label').textContent='Step '+meta.step+' of '+PAGE_IDS.length;$('page-title').textContent=meta.title;$('page-summary').textContent=meta.summary;$('page-content').textContent='This shell is ready for the page-specific controls in the next implementation PRs. Saved selections and checks are rendered from server-owned wizard state.';const check=page.lastCheck;if(check?.ok){$('status').className='status ok';$('status').innerHTML='<div class="status-title">Requirements passed</div><div class="status-copy"></div>';$('status').querySelector('.status-copy').textContent=check.summary||'This page is ready to continue.'}else if(check){$('status').className='status blocked';$('status').innerHTML='<div class="status-title">Needs attention</div><div class="status-copy"></div>';$('status').querySelector('.status-copy').textContent=check.summary||(check.blockers?.[0]?.message)||'Recheck this page.'}else{$('status').className='status';$('status').innerHTML='<div class="status-title">Not checked yet</div><div class="status-copy">Use Recheck after completing this page.</div>'}technical={sessionId:session?.id||null,page:visiblePage,selections:page.selections||{},lastCheck:check||null};$('technical-details').textContent=JSON.stringify(technical,null,2);const index=PAGE_IDS.indexOf(visiblePage);$('back').disabled=index===0;$('continue').disabled=page.completed!==true;$('continue').textContent=index===PAGE_IDS.length-1?'Finish':'Continue';const desired=pathFor(visiblePage);if(location.pathname!==desired){history[replaceHistory?'replaceState':'pushState']({page:visiblePage},'',desired)}}
async function load(){try{store=await api('/api/setup/session');if(!store.activeSession){const started=await api('/api/setup/session/start',{method:'POST',body:'{}'});store={...store,activeSession:started.session}}visiblePage=nearestPermitted(requestedPage);render({replaceHistory:true})}catch(error){showError(error)}}
async function navigate(direction){try{const body=await api('/api/setup/session/navigate',{method:'POST',body:JSON.stringify({direction})});store={...store,activeSession:body.session};visiblePage=body.session.currentPage;render()}catch(error){showError(error)}}
$('back').addEventListener('click',()=>navigate('back'));
$('continue').addEventListener('click',async()=>{if(visiblePage===PAGE_IDS.at(-1)){try{const body=await api('/api/setup/session/complete',{method:'POST',body:'{}'});store={...store,activeSession:null};location.assign('/')}catch(error){showError(error)}return}await navigate('forward')});
$('recheck').addEventListener('click',async()=>{try{const body=await api('/api/setup/session/recheck',{method:'POST',body:JSON.stringify({pageId:visiblePage})});store={...store,activeSession:body.session};render()}catch(error){showError(error)}});
document.querySelectorAll('.step').forEach((button)=>button.addEventListener('click',()=>{const page=button.dataset.page;if(!permitted(page))return;visiblePage=page;render()}));
addEventListener('popstate',()=>{const page=location.pathname.split('/').filter(Boolean).at(-1);visiblePage=PAGE_IDS.includes(page)&&permitted(page)?page:nearestPermitted(page);render({replaceHistory:visiblePage!==page})});
load();
</script>
</body>
</html>`;
}
