export const PR_REVIEW_DASHBOARD_STYLE = String.raw`
#view-pr-reviews .pr-review-section { margin-top: 14px; }
#view-pr-reviews .pr-review-health { margin-top: 12px; }
#view-pr-reviews .pr-review-item {
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 13px;
}
#view-pr-reviews .pr-review-item.active { box-shadow: inset 3px 0 0 var(--purple); }
#view-pr-reviews .pr-review-item.failed { box-shadow: inset 3px 0 0 var(--danger); }
#view-pr-reviews .pr-review-item.fixing { box-shadow: inset 3px 0 0 var(--accent); }
#view-pr-reviews .pr-review-title { font-weight: 820; line-height: 1.3; }
#view-pr-reviews .pr-review-error,
#view-pr-reviews .pr-review-finding {
  margin-top: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  font-size: 12px;
}
#view-pr-reviews .pr-review-error {
  background: rgba(248,81,73,.08);
  border: 1px solid rgba(248,81,73,.25);
  color: #ff9b96;
}
#view-pr-reviews .pr-review-finding {
  background: rgba(188,140,255,.08);
  border: 1px solid rgba(188,140,255,.2);
  color: #dbc6ff;
}
#view-pr-reviews .pr-review-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 12px;
  font-weight: 780;
  text-decoration: none;
}
#view-pr-reviews .pr-review-link:hover { filter: brightness(1.08); text-decoration: none; }
#view-pr-reviews .pr-review-event {
  position: relative;
  padding: 9px 10px 9px 14px;
  border-left: 2px solid var(--border-strong);
  background: var(--panel-3);
  border-radius: 0 8px 8px 0;
}
#view-pr-reviews .pr-review-event time { color: var(--faint); font-size: 11px; }
#view-pr-reviews .pr-review-event .details { color: var(--muted); font-size: 12px; white-space: pre-wrap; }
#controller-actions.controller-action-bar { align-items: center; }
#controller-action-state { min-height: 38px; padding-inline: 12px; }

.dedicated-browser-card {
  grid-column: 1 / -1;
  padding: 20px;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 0%, rgba(88,166,255,.09), transparent 32rem),
    linear-gradient(180deg, rgba(18,28,43,.99), rgba(12,20,32,.99));
  border-color: #31435e;
  box-shadow: 0 18px 44px rgba(0,0,0,.24);
}
.browser-card-heading {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}
.browser-card-heading h2 { margin: 0; font-size: clamp(21px, 2.4vw, 29px); letter-spacing: -.02em; }
.browser-card-heading p { margin: 5px 0 0; color: var(--muted); font-size: 14px; }
.browser-monitor-icon {
  position: relative;
  flex: 0 0 46px;
  width: 46px;
  height: 34px;
  border: 3px solid #c7d7eb;
  border-radius: 5px;
  box-shadow: 0 0 0 4px rgba(88,166,255,.06);
}
.browser-monitor-icon::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -10px;
  width: 4px;
  height: 8px;
  border-radius: 3px;
  background: #c7d7eb;
  transform: translateX(-50%);
}
.browser-monitor-icon::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -13px;
  width: 22px;
  height: 3px;
  border-radius: 3px;
  background: #c7d7eb;
  transform: translateX(-50%);
}
.browser-status-shell {
  border: 1px solid #31435e;
  border-radius: 13px;
  overflow: hidden;
  background: rgba(6,13,23,.45);
}
.browser-status-loading { padding: 24px; color: var(--muted); text-align: center; }
.browser-progress-summary,
.browser-status-row {
  display: grid;
  align-items: center;
  gap: 14px;
  min-height: 70px;
  padding: 13px 20px;
}
.browser-progress-summary {
  grid-template-columns: 34px minmax(230px, auto) minmax(180px, 1fr) 54px;
  border-bottom: 1px solid #2a3a50;
}
.browser-progress-summary strong { font-size: 14px; }
.browser-progress-summary em { color: var(--accent); font-style: normal; }
.browser-summary-icon,
.browser-status-icon {
  display: inline-grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border: 2px solid currentColor;
  border-radius: 50%;
  color: var(--accent);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
}
.browser-overall-track,
.browser-status-track {
  position: relative;
  display: block;
  height: 12px;
  overflow: hidden;
  border: 1px solid #354b68;
  border-radius: 999px;
  background: #0b1522;
}
.browser-overall-track > span,
.browser-status-track > span {
  display: block;
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  transition: width .22s ease;
}
.browser-overall-track > span { background: linear-gradient(90deg, #3e91ff, #65b1ff); box-shadow: 0 0 16px rgba(88,166,255,.4); }
.browser-progress-percent { color: var(--accent); text-align: right; font-size: 16px; }
.browser-status-list { display: grid; }
.browser-status-row {
  grid-template-columns: 34px minmax(220px, .46fr) minmax(180px, 1fr) minmax(126px, auto);
  border-bottom: 1px solid #2a3a50;
}
.browser-status-row:last-child { border-bottom: 0; }
.browser-status-label { font-size: 15px; }
.browser-status-value {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  min-width: 126px;
  font-weight: 760;
  white-space: nowrap;
}
.browser-status-value i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 13%, transparent);
}
.browser-tone-success { color: var(--success); }
.browser-tone-danger { color: #ff615a; }
.browser-tone-warning { color: #f0b938; }
.browser-tone-info { color: #60aaff; }
.browser-status-row .browser-status-label { color: var(--text); }
.browser-tone-success .browser-status-track { border-color: rgba(63,185,80,.55); }
.browser-tone-success .browser-status-track > span { background: linear-gradient(90deg, #2fbf61, #5bd77f); }
.browser-tone-danger .browser-status-track { border-color: rgba(248,81,73,.8); }
.browser-tone-danger .browser-status-track > span { background: #f85149; }
.browser-tone-warning .browser-status-track { border-color: rgba(210,153,34,.55); }
.browser-tone-warning .browser-status-track > span { background: linear-gradient(90deg, #edae25, #ffc84a); }
.browser-tone-info .browser-status-track { border-color: rgba(88,166,255,.55); }
.browser-tone-info .browser-status-track > span { background: linear-gradient(90deg, #3d8fff, #64b2ff); }
.browser-profile-lock {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-top: 14px;
  min-height: 62px;
  padding: 12px 18px;
  border: 1px solid #31435e;
  border-radius: 13px;
  background: rgba(10,18,30,.62);
}
.browser-lock-icon {
  display: inline-grid;
  place-items: center;
  width: 37px;
  height: 37px;
  border-radius: 50%;
  background: #1b2a40;
  color: #d7e5f7;
  font-size: 17px;
}
.browser-lock-chip {
  display: inline-flex;
  align-items: center;
  min-height: 31px;
  padding: 5px 13px;
  border: 1px solid #314663;
  border-radius: 999px;
  background: #13233a;
  color: #69afff;
  font-size: 12px;
  font-weight: 800;
}
.browser-lock-chip.busy { color: #f0b938; border-color: rgba(210,153,34,.5); background: rgba(210,153,34,.08); }
.browser-action-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(145px, 1fr));
  gap: 9px;
  margin-top: 16px;
}
.browser-action-grid button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  padding: 9px 12px;
  border-color: #344964;
  background: #111d2c;
  white-space: nowrap;
}
.browser-action-grid button span { font-size: 17px; }
.browser-action-grid .browser-primary-action {
  background: linear-gradient(180deg, #2d72ed, #235dd1);
  border-color: #3d83ff;
  box-shadow: 0 8px 20px rgba(35,93,209,.22);
}
.browser-action-grid .browser-uninstall-action {
  color: #ff706b;
  background: rgba(182,35,36,.08);
  border-color: rgba(248,81,73,.72);
}
.browser-helper {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 16px 3px 0;
  color: var(--muted);
  font-size: 13px;
}
.browser-helper span { color: #bdd0e6; font-size: 16px; }

@media (max-width: 1180px) {
  .browser-action-grid { grid-template-columns: repeat(3, minmax(160px, 1fr)); }
}
@media (max-width: 860px) {
  .browser-progress-summary { grid-template-columns: 34px 1fr 52px; }
  .browser-progress-summary .browser-overall-track { grid-column: 2 / -1; }
  .browser-status-row { grid-template-columns: 34px 1fr auto; }
  .browser-status-row .browser-status-track { grid-column: 2 / -1; }
}
@media (max-width: 720px) {
  #controller-actions.controller-action-bar { width: 100%; justify-content: flex-start; }
  #controller-action-state { order: -1; width: 100%; justify-content: center; }
  .dedicated-browser-card { padding: 14px; }
  .browser-card-heading { align-items: flex-start; }
  .browser-progress-summary,
  .browser-status-row { padding: 12px 13px; }
  .browser-progress-summary { grid-template-columns: 30px 1fr auto; }
  .browser-status-row { grid-template-columns: 30px 1fr; gap: 10px; }
  .browser-status-value { grid-column: 2; min-width: 0; }
  .browser-status-row .browser-status-track { grid-column: 1 / -1; }
  .browser-action-grid { grid-template-columns: 1fr; }
  .browser-action-grid button { white-space: normal; }
}
`;
