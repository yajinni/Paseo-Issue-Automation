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
@media (max-width: 720px) {
  #controller-actions.controller-action-bar { width: 100%; justify-content: flex-start; }
  #controller-action-state { order: -1; width: 100%; justify-content: center; }
}
`;
