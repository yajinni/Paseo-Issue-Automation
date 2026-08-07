export const PASEO_UI_THEME_CSS = String.raw`
:root{
  color-scheme:dark;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --paseo-bg:#0d1117;
  --paseo-bg-bottom:#151b24;
  --paseo-panel:#171e28;
  --paseo-card:#121923;
  --paseo-card-alt:#111821;
  --paseo-input:#0f151e;
  --paseo-border:#293445;
  --paseo-border-strong:#43526a;
  --paseo-text:#eef2f7;
  --paseo-muted:#9fb0c5;
  --paseo-muted-soft:#8797aa;
  --paseo-primary:#2f6fed;
  --paseo-primary-hover:#3d7bfa;
  --paseo-secondary:#222d3d;
  --paseo-selected:#243044;
  --paseo-success:#2f8d55;
  --paseo-success-bg:#12261a;
  --paseo-warning:#9b7729;
  --paseo-warning-bg:#2b2515;
  --paseo-danger:#b74b4b;
  --paseo-danger-bg:#301820;
  --paseo-info:#365f8b;
  --paseo-info-bg:#122238;
  --paseo-radius-sm:8px;
  --paseo-radius:10px;
  --paseo-radius-lg:14px;
  --paseo-shadow:0 12px 40px #0004;
}

.paseo-ui-surface{background:var(--paseo-panel);border:1px solid var(--paseo-border);border-radius:var(--paseo-radius-lg);box-shadow:var(--paseo-shadow)}
.paseo-ui-card{background:var(--paseo-card);border:1px solid #2d394b;border-radius:12px}
.paseo-ui-muted{color:var(--paseo-muted)}
.paseo-ui-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--paseo-border-strong);background:var(--paseo-secondary);color:var(--paseo-text);border-radius:9px;padding:10px 14px;font-weight:650;cursor:pointer;text-decoration:none}
.paseo-ui-button:hover:not(:disabled){border-color:#53647c;background:#29364a}
.paseo-ui-button.primary{background:var(--paseo-primary);border-color:var(--paseo-primary)}
.paseo-ui-button.primary:hover:not(:disabled){background:var(--paseo-primary-hover);border-color:var(--paseo-primary-hover)}
.paseo-ui-button.warning{background:#8b621d;border-color:#a77924}
.paseo-ui-button.danger{background:#9c3342;border-color:#b64554}
.paseo-ui-button:disabled,.paseo-ui-button.disabled{opacity:.45;cursor:not-allowed}
.paseo-ui-button:focus-visible,.paseo-ui-focus:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}

@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export function sharedUiThemeStyleTag(attribute = 'data-paseo-ui-theme') {
  return `<style ${attribute}>${PASEO_UI_THEME_CSS}</style>`;
}
