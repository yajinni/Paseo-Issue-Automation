export const MANAGER_EXPANDED_SIDE_ACTIONS_STYLE = String.raw`
.lifecycle-row-head .lifecycle-row-actions>[data-work-details],
.lifecycle-row-head .lifecycle-row-actions>[data-actions-toggle],
.lifecycle-row-head .lifecycle-row-actions>.lifecycle-actions-popover{display:none!important}
.lifecycle-expanded-side{min-width:0;display:grid;gap:8px;align-content:start}
.lifecycle-expanded-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;position:relative;min-height:32px;padding:0 1px}
.lifecycle-expanded-actions button{padding:7px 9px;font-size:11px}
.lifecycle-expanded-side .activity-card{min-width:0}
@media(max-width:900px){.lifecycle-expanded-side{order:2}}
@media(max-width:560px){.lifecycle-row-head .lifecycle-row-actions{grid-column:auto;justify-content:flex-end}.lifecycle-expanded-actions{grid-column:auto;justify-content:flex-end}}
`;

export const MANAGER_EXPANDED_SIDE_ACTIONS_SCRIPT = String.raw`
(function() {
  function arrangeExpandedControls() {
    document.querySelectorAll('.lifecycle-item.expanded').forEach(function(item) {
      const panel = item.querySelector('.lifecycle-expanded');
      const rowActions = item.querySelector('.lifecycle-row-head .lifecycle-row-actions');
      const activity = panel?.querySelector('.activity-card');
      if (!panel || !rowActions || !activity) return;

      let side = panel.querySelector('.lifecycle-expanded-side');
      if (!side) {
        side = document.createElement('div');
        side.className = 'lifecycle-expanded-side';
        activity.replaceWith(side);
        side.append(activity);
      }

      let controls = side.querySelector('.lifecycle-expanded-actions');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'lifecycle-row-actions lifecycle-expanded-actions';
        controls.setAttribute('aria-label', 'Issue troubleshooting and actions');
        side.prepend(controls);
      }

      [...rowActions.children]
        .filter(function(element) {
          return element.matches('[data-work-details],[data-actions-toggle],.lifecycle-actions-popover');
        })
        .forEach(function(element) { controls.append(element); });
    });
  }

  function start() {
    arrangeExpandedControls();
    const list = document.getElementById('work-queue-list');
    if (!list || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(arrangeExpandedControls);
    observer.observe(list, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
`;
