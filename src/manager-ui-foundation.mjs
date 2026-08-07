import { injectIntoHead } from './ui-html.mjs';
import { sharedUiThemeStyleTag } from './ui-theme.mjs';

export const MANAGER_UI_FOUNDATION_CSS = String.raw`
body{margin:0;background:linear-gradient(180deg,var(--paseo-bg),var(--paseo-bg-bottom));min-height:100vh;color:var(--paseo-text)}
.shell{max-width:1120px;margin:0 auto;padding:24px}
.header{gap:16px;margin-bottom:20px}
.header h1{font-size:22px;margin:4px 0 0}
.muted{color:var(--paseo-muted)}
.card,.manager-overview{background:var(--paseo-card);border:1px solid #2d394b;border-radius:12px;box-shadow:none}
.manager-overview{border-radius:var(--paseo-radius-lg);box-shadow:var(--paseo-shadow)}
.banner{border:1px solid #334156;background:var(--paseo-card-alt);border-radius:10px;color:var(--paseo-muted)}
.banner.error{border-color:#804844;background:var(--paseo-danger-bg);color:var(--paseo-text)}
select,input:not([type="checkbox"]){background:var(--paseo-input);color:var(--paseo-text);border:1px solid #3a485c;border-radius:8px;padding:10px 11px}
button,.manager-setup-link,.overview-primary-action a{border:1px solid var(--paseo-border-strong);background:var(--paseo-secondary);color:var(--paseo-text);border-radius:9px;padding:10px 14px;font-weight:650;cursor:pointer;text-decoration:none}
button:hover:not(:disabled),.manager-setup-link:hover,.overview-primary-action a:hover{border-color:#53647c;background:#29364a}
button:not(.secondary):not(.warning):not(.danger){background:var(--paseo-primary);border-color:var(--paseo-primary)}
button:not(.secondary):not(.warning):not(.danger):hover:not(:disabled){background:var(--paseo-primary-hover);border-color:var(--paseo-primary-hover)}
button.secondary{background:var(--paseo-secondary);border-color:var(--paseo-border-strong)}
button.warning{background:#8b621d;border-color:#a77924}
button.danger{background:#9c3342;border-color:#b64554}
button:disabled{opacity:.45;cursor:not-allowed}
button:focus-visible,.manager-setup-link:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}
.manager-setup-link{display:inline-flex;align-items:center;background:var(--paseo-primary);border-color:var(--paseo-primary)}
.manager-manual-registration summary{color:var(--paseo-text)}
pre{background:#0d1219;border:1px solid #253042;color:var(--paseo-muted);border-radius:9px}
.overview-metric{background:var(--paseo-card-alt);border-color:#2b394d}
.overview-ready{border-color:#356b4a;background:var(--paseo-success-bg)}
.overview-blocked{border-color:#894351;background:var(--paseo-danger-bg)}
.overview-attention{border-color:#80672c;background:var(--paseo-warning-bg)}
.overview-active{border-color:var(--paseo-info);background:var(--paseo-info-bg)}
.blocker{background:var(--paseo-card-alt);border-color:#30445f}
.blocker-error{border-color:#894351;background:var(--paseo-danger-bg)}
.blocker-warning{border-color:#80672c;background:var(--paseo-warning-bg)}
.blocker-ready{border-color:#356b4a;background:var(--paseo-success-bg)}
.blocker a{color:#8ab8ff}
@media(max-width:760px){.shell{padding:14px}}
`;

export function enhanceManagerWithUiFoundation(html) {
  const payload = `${sharedUiThemeStyleTag('data-paseo-ui-theme="manager"')}<style data-manager-ui-foundation>${MANAGER_UI_FOUNDATION_CSS}</style>`;
  return injectIntoHead(html, payload);
}

export function enhanceSetupWithSharedUiTheme(html) {
  return injectIntoHead(html, sharedUiThemeStyleTag('data-paseo-ui-theme="setup"'));
}
