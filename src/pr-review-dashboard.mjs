export function prReviewDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=/#pr-reviews">
<title>Opening PR Reviews</title>
</head>
<body>
<p>Opening PR Reviews in the main dashboard…</p>
<script>location.replace('/#pr-reviews');</script>
</body>
</html>`;
}
