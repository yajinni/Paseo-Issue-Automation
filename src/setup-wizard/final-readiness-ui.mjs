export const FINAL_READINESS_SCRIPT = String.raw`
(function finalReadinessPage(){
  let state=null,loading=false;
  const content=()=>document.getElementById('page-content');
  const onPage=()=>location.pathname.replace(/\/$/,'').split('/').at(-1)==='readiness';
  const esc=(value)=>String(value==null?'':value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const labels={paseo:'Connect Paseo',harness:'Coding harness',repository:'GitHub repository',issues:'Issues setup',review:'Review setup'};
  function render(){
    if(!onPage()||!state||!content())return;
    const check=state.check||{};
    const pageById=new Map((state.pages||[]).map((page)=>[page.id,page]));
    const rows=(state.checks||[]).map((item)=>{
      const informational=item.informational===true;
      const rowClass=informational?'info':(item.ok?'ok':'bad');
      const marker=informational?'i':(item.ok?'✓':'!');
      const page=pageById.get(item.id);
      const label=esc(item.label||labels[item.id]||item.id);
      const heading=page?.href?'<a href="'+esc(page.href)+'">'+label+'</a>':label;
      const link=item.url?'<div class="check-detail"><a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">Open setup PR'+(item.number?' #'+esc(item.number):'')+'</a></div>':'';
      return '<div class="check-row '+rowClass+'"><span class="check-dot">'+marker+'</span><div><strong>'+heading+'</strong><div class="check-detail">'+esc(item.summary||item.state||'')+'</div>'+link+'</div></div>';
    }).join('');
    content().className='';
    content().innerHTML='<div class="paseo-grid">'
      +'<section class="setup-card"><h3>Final setup check</h3><p>Confirm the saved setup and any repository repair before finishing.</p><div class="checklist">'+rows+'</div><div class="notice">Repository: <strong>'+esc(state.repository||'')+'</strong> · Base branch: <strong>'+esc(state.baseBranch||'')+'</strong></div><div class="inline-actions" style="margin-top:12px"><button class="action" id="readiness-recheck" type="button">Recheck</button></div></section>'
      +'<section class="setup-card"><label class="choice" style="font-size:16px;font-weight:650"><input id="readiness-start" type="checkbox" '+(state.startAutomationDefault?'checked':'')+'> Start automation after setup</label></section></div>';
    document.getElementById('readiness-recheck')?.addEventListener('click',()=>refresh(true));
    const continueButton=document.getElementById('continue');if(continueButton)continueButton.disabled=check.ok!==true;
    const shell=document.getElementById('status');if(shell&&check){shell.className='status '+(check.ok?'ok':'blocked');shell.innerHTML='<div class="status-title">'+esc(check.ok?'Ready to finish':'Needs attention')+'</div><div class="status-copy">'+esc(check.summary||'')+'</div>';}
    if(typeof technical!=='undefined')technical={safeProbePolicy:state.safeProbePolicy||{},eligibleIssueCount:state.eligibleIssueCount||0};
    const details=document.getElementById('technical-details');if(details)details.textContent=JSON.stringify(technical||{},null,2);
  }
  async function refresh(force=false){if(!onPage()||loading)return;loading=true;try{state=await api(force?'/api/setup/readiness/recheck':'/api/setup/readiness/summary',{method:force?'POST':'GET',body:force?'{}':undefined});if(!state.check&&force===false){state=await api('/api/setup/readiness/recheck',{method:'POST',body:'{}'});}render();}catch(error){if(typeof showError==='function')showError(error);}finally{loading=false;}}
  async function finish(){if(loading||!state?.check?.ok)return;loading=true;try{const startAutomation=document.getElementById('readiness-start')?.checked===true;const result=await api('/api/setup/readiness/finish',{method:'POST',body:JSON.stringify({startAutomation})});location.href='/';return result;}catch(error){if(typeof showError==='function')showError(error);}finally{loading=false;}}
  const observer=new MutationObserver(()=>{if(onPage()&&content()&&!content().querySelector('#readiness-start'))refresh(false);});
  const title=document.getElementById('page-title');if(title)observer.observe(title,{childList:true,subtree:true});
  document.addEventListener('click',(event)=>{const button=event.target?.closest?.('#continue');if(!button||button.disabled||!onPage())return;event.preventDefault();event.stopImmediatePropagation();finish();},true);
  document.getElementById('recheck')?.addEventListener('click',(event)=>{if(!onPage())return;event.preventDefault();event.stopImmediatePropagation();refresh(true);},true);
  addEventListener('popstate',()=>{if(onPage())refresh(false);});if(onPage())refresh(false);
})();
`;

const FINAL_READINESS_STYLE = String.raw`
<style data-setup-final-readiness-style>
.check-row.info .check-dot{background:#243044;border-color:#43526a;color:#c8d6e8}
</style>`;

export function enhanceSetupWizardWithFinalReadiness(html){
  const script=`<script data-setup-final-readiness>${FINAL_READINESS_SCRIPT}</script>`;
  let output=String(html);
  output=output.includes('</head>')?output.replace('</head>',`${FINAL_READINESS_STYLE}</head>`):`${FINAL_READINESS_STYLE}${output}`;
  return output.includes('</body>')?output.replace('</body>',`${script}</body>`):`${output}${script}`;
}
