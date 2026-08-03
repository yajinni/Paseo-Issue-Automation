export const CONTROL_CENTER_STYLE = String.raw`
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --bg: #090d14;
  --panel: #111823;
  --panel-2: #161f2c;
  --panel-3: #0c121c;
  --border: #273447;
  --border-strong: #3b4c65;
  --text: #edf3fb;
  --muted: #98a7ba;
  --faint: #6f8097;
  --accent: #58a6ff;
  --accent-2: #238636;
  --warning: #d29922;
  --danger: #f85149;
  --success: #3fb950;
  --purple: #bc8cff;
  --shadow: 0 18px 50px rgba(0,0,0,.28);
}
* { box-sizing: border-box; }
html { min-height: 100%; background: var(--bg); }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, rgba(88,166,255,.09), transparent 34rem), var(--bg); color: var(--text); }
button, input, select, textarea { font: inherit; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid rgba(88,166,255,.55); outline-offset: 2px; }
.skip-link { position: fixed; left: 12px; top: -60px; z-index: 1000; background: var(--text); color: var(--bg); padding: 10px 14px; border-radius: 8px; }
.skip-link:focus { top: 12px; }
.app-shell { max-width: 1480px; margin: 0 auto; padding: 20px 22px 70px; }
.app-header { position: sticky; top: 0; z-index: 20; margin: 0 -8px 18px; padding: 14px 10px 12px; backdrop-filter: blur(16px); background: linear-gradient(180deg, rgba(9,13,20,.96), rgba(9,13,20,.78)); border-bottom: 1px solid rgba(39,52,71,.7); }
.header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.brand h1 { margin: 0 0 5px; font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; }
.brand p { margin: 0; color: var(--muted); }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.health-strip { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.chip { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 5px 10px; border-radius: 999px; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted); font-size: 12px; font-weight: 700; }
.chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
.chip.good::before { background: var(--success); box-shadow: 0 0 0 3px rgba(63,185,80,.12); }
.chip.warn::before { background: var(--warning); }
.chip.bad::before { background: var(--danger); }
.chip.info::before { background: var(--accent); }
.nav-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 0 0 8px; margin-bottom: 16px; scrollbar-width: thin; }
.nav-tab { white-space: nowrap; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--muted); padding: 10px 13px; cursor: pointer; font-weight: 750; }
.nav-tab:hover { background: var(--panel); color: var(--text); }
.nav-tab.active { color: var(--text); background: var(--panel-2); border-color: var(--border); }
.view { display: none; }
.view.active { display: block; }
.grid { display: grid; gap: 14px; }
.grid.metrics { grid-template-columns: repeat(5, minmax(130px, 1fr)); }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card { background: linear-gradient(180deg, rgba(22,31,44,.98), rgba(17,24,35,.98)); border: 1px solid var(--border); border-radius: 14px; padding: 16px; box-shadow: 0 8px 22px rgba(0,0,0,.12); }
.card h2, .card h3 { margin: 0; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
.card-head p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
.metric { cursor: pointer; transition: transform .15s ease, border-color .15s ease; text-align: left; }
.metric:hover { transform: translateY(-1px); border-color: var(--border-strong); }
.metric .value { display: block; margin-top: 9px; font-size: 30px; font-weight: 850; }
.metric .label { color: var(--muted); font-size: 13px; font-weight: 750; }
.metric.review { border-color: rgba(188,140,255,.45); }
.metric.failed { border-color: rgba(248,81,73,.35); }
button { border: 1px solid transparent; border-radius: 8px; min-height: 38px; padding: 8px 12px; cursor: pointer; font-weight: 780; background: var(--accent-2); color: white; }
button:hover { filter: brightness(1.08); }
button.secondary { background: var(--panel-2); border-color: var(--border); color: var(--text); }
button.warning { background: #9e6a03; }
button.danger { background: #b62324; }
button.ghost { background: transparent; border-color: var(--border); color: var(--muted); }
button.small { min-height: 32px; padding: 5px 9px; font-size: 12px; }
button:disabled { cursor: not-allowed; opacity: .45; filter: none; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.section-stack { display: grid; gap: 14px; }
.list { display: grid; gap: 10px; }
.empty { padding: 24px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); text-align: center; }
.issue-card { background: var(--panel-3); border: 1px solid var(--border); border-radius: 11px; padding: 13px; }
.issue-card.important { border-color: rgba(188,140,255,.58); box-shadow: inset 3px 0 0 var(--purple); }
.issue-card.blocked { box-shadow: inset 3px 0 0 var(--warning); }
.issue-card.failed { box-shadow: inset 3px 0 0 var(--danger); }
.issue-card.running { box-shadow: inset 3px 0 0 var(--accent); }
.issue-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.issue-title { font-weight: 820; line-height: 1.3; }
.issue-subtitle { color: var(--muted); font-size: 12px; margin-top: 4px; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--muted); font-size: 11px; font-weight: 780; }
.badge.ready { color: var(--success); border-color: rgba(63,185,80,.35); }
.badge.running { color: var(--accent); border-color: rgba(88,166,255,.4); }
.badge.blocked { color: var(--warning); border-color: rgba(210,153,34,.4); }
.badge.failed { color: var(--danger); border-color: rgba(248,81,73,.4); }
.badge.review { color: var(--purple); border-color: rgba(188,140,255,.42); }
.meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px 14px; margin-top: 11px; color: var(--muted); font-size: 12px; }
.meta-grid strong { color: var(--text); font-weight: 700; }
.reason { margin-top: 10px; padding: 9px 10px; border-radius: 8px; background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.2); color: #e8c36d; font-size: 12px; white-space: pre-wrap; }
.review-findings { margin-top: 10px; padding: 10px; border-radius: 8px; background: rgba(188,140,255,.08); border: 1px solid rgba(188,140,255,.2); color: #d8bfff; font-size: 12px; white-space: pre-wrap; }
.timeline { display: grid; gap: 8px; max-height: 480px; overflow: auto; padding-right: 4px; }
.timeline-entry { position: relative; padding: 9px 10px 9px 14px; border-left: 2px solid var(--border-strong); background: var(--panel-3); border-radius: 0 8px 8px 0; }
.timeline-entry .time { color: var(--faint); font-size: 11px; }
.timeline-entry .event { font-weight: 760; margin: 2px 0; }
.timeline-entry .details { color: var(--muted); font-size: 12px; white-space: pre-wrap; }
.wave { display: grid; grid-template-columns: 86px 1fr; gap: 12px; align-items: start; padding: 12px 0; border-top: 1px solid var(--border); }
.wave:first-child { border-top: 0; }
.wave-label { color: var(--accent); font-weight: 850; }
.wave-issues { display: flex; flex-wrap: wrap; gap: 8px; }
.dependency-node { min-width: 180px; flex: 1 1 220px; background: var(--panel-3); border: 1px solid var(--border); border-radius: 10px; padding: 11px; }
.dependency-line { color: var(--muted); font-size: 12px; margin-top: 6px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.filter-button { background: transparent; border-color: var(--border); color: var(--muted); }
.filter-button.active { background: var(--panel-2); color: var(--text); border-color: var(--accent); }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 720; }
input, select, textarea { width: 100%; border: 1px solid var(--border); background: var(--panel-3); color: var(--text); border-radius: 8px; padding: 10px; }
textarea { min-height: 96px; resize: vertical; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panel-3); border: 1px solid var(--border); border-radius: 8px; padding: 11px; color: #c7d3e3; font-size: 12px; max-height: 360px; overflow: auto; }
.setup-step { border-left: 3px solid var(--border); }
.setup-step.done { border-left-color: var(--success); }
.component-list { display: grid; gap: 9px; }
.component { background: var(--panel-3); border: 1px solid var(--border); border-radius: 9px; padding: 11px; }
.component-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.component p { color: var(--muted); margin: 6px 0 10px; font-size: 12px; }
.status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--faint); display: inline-block; }
.status-dot.good { background: var(--success); }
.status-dot.bad { background: var(--danger); }
.toast-region { position: fixed; right: 18px; bottom: 18px; z-index: 100; display: grid; gap: 8px; width: min(420px, calc(100vw - 36px)); }
.toast { background: var(--panel-2); border: 1px solid var(--border-strong); box-shadow: var(--shadow); padding: 12px 14px; border-radius: 10px; }
.toast.bad { border-color: rgba(248,81,73,.55); }
dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--panel); color: var(--text); padding: 0; box-shadow: var(--shadow); }
dialog::backdrop { background: rgba(0,0,0,.72); backdrop-filter: blur(4px); }
.dialog-head { position: sticky; top: 0; z-index: 2; background: var(--panel); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border); }
.dialog-body { padding: 16px; }
.dialog-footer { position: sticky; bottom: 0; background: var(--panel); display: flex; justify-content: flex-end; gap: 8px; padding: 13px 16px; border-top: 1px solid var(--border); }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.hidden { display: none !important; }
.muted { color: var(--muted); }
.good-text { color: var(--success); }
.warn-text { color: var(--warning); }
.bad-text { color: var(--danger); }
.split-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
@media (max-width: 1080px) {
  .grid.metrics { grid-template-columns: repeat(3, minmax(130px, 1fr)); }
  .grid.three { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .app-shell { padding: 12px 12px 54px; }
  .app-header { position: static; margin: 0 0 14px; padding: 8px 0 12px; }
  .header-top { display: grid; }
  .header-actions { justify-content: flex-start; }
  .grid.metrics, .grid.two, .grid.three, .field-grid { grid-template-columns: 1fr; }
  .metric { display: flex; align-items: center; justify-content: space-between; }
  .metric .value { margin: 0; }
  .issue-head { display: grid; }
  .wave { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
