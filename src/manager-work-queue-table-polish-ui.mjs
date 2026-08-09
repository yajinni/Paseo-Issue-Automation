export const MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE = String.raw`
@media(min-width:1181px){
  .lifecycle-table{--lifecycle-row-columns:72px minmax(225px,1.55fr) minmax(145px,.85fr) minmax(205px,1.05fr) 72px 118px 125px 82px minmax(28px,auto)}
  .lifecycle-columns,.lifecycle-row-head{grid-template-columns:var(--lifecycle-row-columns);column-gap:12px}
}
@media(min-width:901px) and (max-width:1180px){
  .lifecycle-table{--lifecycle-row-columns:64px minmax(190px,1.45fr) 132px minmax(180px,.95fr) 65px 106px 112px 78px minmax(28px,auto)}
  .lifecycle-columns,.lifecycle-row-head{grid-template-columns:var(--lifecycle-row-columns);column-gap:10px}
}
@media(min-width:901px){
  .lifecycle-columns>span,.lifecycle-row-head>*{min-width:0;justify-self:stretch}
  .lifecycle-columns>span:nth-child(3){padding-left:13px}
}
.lifecycle-run-summary .lifecycle-run-secondary{display:block;font-size:10px;color:#8fa0b4;margin-top:2px;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.35}
.lifecycle-run-summary .lifecycle-run-provider,.lifecycle-run-summary .lifecycle-run-model{display:block;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
`;

export const MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT = String.raw`
(function managerWorkQueueTablePolish() {
  function splitRunDetailModels(root) {
    const scope = root || document;
    scope.querySelectorAll('.lifecycle-run-summary > span:not([data-run-detail-wrap])').forEach(function(copy) {
      copy.dataset.runDetailWrap = 'true';
      const value = String(copy.textContent || '').trim();
      const slash = value.lastIndexOf('/');
      if (slash < 0 || slash >= value.length - 1) return;
      const provider = document.createElement('span');
      provider.className = 'lifecycle-run-provider';
      provider.textContent = value.slice(0, slash + 1);
      const model = document.createElement('span');
      model.className = 'lifecycle-run-model';
      model.textContent = value.slice(slash + 1);
      copy.textContent = '';
      copy.classList.add('lifecycle-run-secondary');
      copy.append(provider, model);
    });
  }

  function install() {
    const list = document.getElementById('work-queue-list');
    if (!list) return false;
    splitRunDetailModels(list);
    if (list.dataset.tablePolishObserver === 'true') return true;
    list.dataset.tablePolishObserver = 'true';
    const observer = new MutationObserver(function() { splitRunDetailModels(list); });
    observer.observe(list, { childList: true, subtree: true });
    return true;
  }

  if (!install()) {
    const view = document.querySelector('[data-manager-view="work-queue"]');
    if (view) {
      const observer = new MutationObserver(function() {
        if (install()) observer.disconnect();
      });
      observer.observe(view, { childList: true, subtree: true });
    }
  }
})();
`;
