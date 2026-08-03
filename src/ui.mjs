import { CONTROL_CENTER_SCRIPT } from './control-center-script.mjs';
import { CONTROL_CENTER_SHELL } from './control-center-shell.mjs';
import { CONTROL_CENTER_STYLE } from './control-center-style.mjs';

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
${CONTROL_CENTER_SHELL}
<script>${CONTROL_CENTER_SCRIPT}</script>
</body>
</html>`;
}
