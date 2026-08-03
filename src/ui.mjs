import { CONTROL_CENTER_SCRIPT } from './control-center-script.mjs';
import { CONTROL_CENTER_SHELL } from './control-center-shell.mjs';
import { CONTROL_CENTER_STYLE } from './control-center-style.mjs';
import { SETUP_CONTROLS_SCRIPT } from './setup-controls-script.mjs';
import { SETUP_REFRESH_SCRIPT } from './setup-refresh-script.mjs';

function shellWithPrReviews() {
  return CONTROL_CENTER_SHELL.replace(
    '</nav>',
    '<a class="nav-tab" href="/pr-reviews" aria-label="Open serial PR review management">PR Reviews</a></nav>',
  );
}

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#090d14">
<title>Issue Execution Controller</title>
<style>${CONTROL_CENTER_STYLE}</style>
</head>
<body>
${shellWithPrReviews()}
<script>${CONTROL_CENTER_SCRIPT}</script>
<script>${SETUP_CONTROLS_SCRIPT}</script>
<script>${SETUP_REFRESH_SCRIPT}</script>
</body>
</html>`;
}
