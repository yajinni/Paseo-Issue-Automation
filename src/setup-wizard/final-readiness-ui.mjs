export const FINAL_READINESS_SCRIPT = String.raw`
(function finalReadinessPage(){
  let state=null,loading=false;
  const content=()=>document.getElementById('page-content');
  const onPage=()=>location.pathname.replace(/\/$/,'').split('/').at(-1)==='readiness';
  const esc=(value)=>String(value==null?'':value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  function render(){
    if(!onPage()||!state||!content())return;
    const check=state.check||{};
    const pages=(state.pages||[]).map((page)=>'<div class="check-row '+(page.completed?'ok':'bad')+'"><span class="check-dot">'+(page.completed?'✓':'!')+'</span><div><strong><a href="'+esc(page.href)+'">'+esc(page.id)+'</a></strong><div class="check-detail">'+esc(page.summary||'No successful check recorded.')+'</div></div></div>').join('');
    const probes=(state.checks||[]).map((item)=>{
      const link=item.url?'<div class="check-detail"><a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">Open setup PR'+(item.number?' #'+esc(item.number):'')+'</a></div>':'';
      return '<div class="check-row '+(item.ok?'ok':'bad')+'"><span class="check-dot">'+(item.ok?'✓':'!')+'</span><div><strong>'+esc(item.label||item.id)+'</strong><div class="check-detail">'+esc(item.summary||item.state||'')+'</div>'+link+'</div></div>';
    }).join('');
    content().className='';
    content().innerHTML='<div class="paseo-grid">'
      +'<section class="setup-card"><h3>Approved setup summary</h3><p>Review each saved selection before enabling automation. Each section links back to its setup page.</p><div class="checklist">'+pages+'</div><div class="notice">Repository: <strong>'+esc(state.repository||'')+'</strong> · Base branch: <strong>'+esc(state.baseBranch||'')+'</strong></div></section>'
      +'<section class="setup-card"><h3>Final safe checks</h3><p>Recheck verifies the selected workflows. If managed repository setup files are missing or outdated, Paseo creates a setup pull request to fix them. It does not create fake issues/reviews or send a paid prompt.</p><div class="checklist">'+probes+'</div><div class="inline-actions"><button class="action" id="readiness-recheck" type="button">Recheck</button></div></section>'
      +'<section class="setup-card"><label class="choice" style="font-size:16px;font-weight:650"><input id="readiness-start" type="checkbox" '+(state.startAutomationDefault?'checked':'')+'> Start automation after setup</label><div class="inline-actions" style="margin-top:14px"><button class="action primary" id="readiness-finish" type="button" '+(check.ok?'':'disabled')+'>Finish setup</button></div></section></div>';
    document.getElementById('readiness-recheck')?.addEventListener('click',()=>refresh(true));
    document.getElementById('readiness-finish')?.addEventListener('click',finish);
    const shell=document.getElementById('status');if(shell&&check){shell.className='status '+(check.ok?'ok':'blocked');shell.innerHTML='<div class="status-title">'+esc(check.ok?'Ready to finish':'Needs attention')+'</div><div class="status-copy">'+esc(check.summary||'')+'</div>';}
    if(typeof technical!=='undefined')technical={safeProbePolicy:state.safeProbePolicy||{},eligibleIssueCount:state.eligibleIssueCount||0};
    const details=document.getElementById('technical-details');if(details)details.textContent=JSON.stringify(technical||{},null,2);
  }
  async function refresh(force=false){if(!onPage()||loading)return;loading=true;try{state=await api(force?'/api/setup/readiness/recheck':'/api/setup/readiness/summary',{method:force?'POST':'GET',body:force?'{}':undefined});if(!state.check&&force===false){state=await api('/api/setup/readiness/recheck',{method:'POST',body:'{}'});}render();}catch(error){if(typeof showError==='function')showError(error);}finally{loading=false;}}
  async function finish(){if(loading||!state?.check?.ok)return;loading=true;try{const startAutomation=document.getElementById('readiness-start')?.checked===true;const result=await api('/api/setup/readiness/finish',{method:'POST',body:JSON.stringify({startAutomation})});location.href='/';return result;}catch(error){if(typeof showError==='function')showError(error);}finally{loading=false;}}
  const observer=new MutationObserver(()=>{if(onPage()&&content()&&!content().querySelector('#readiness-finish'))refresh(false);});
  const title=document.getElementById('page-title');if(title)observer.observe(title,{childList:true,subtree:true});
  document.getElementById('recheck')?.addEventListener('click',(event)=>{if(!onPage())return;event.preventDefault();event.stopImmediatePropagation();refresh(true);},true);
  addEventListener('popstate',()=>{if(onPage())refresh(false);});if(onPage())refresh(false);
})();
`;

export function enhanceSetupWizardWithFinalReadiness(html){
  const script=`<script data-setup-final-readiness>${FINAL_READINESS_SCRIPT}</script>`;
  return String(html).includes('</body>')?String(html).replace('</body>',`${script}</body>`):`${html}${script}`;
}
