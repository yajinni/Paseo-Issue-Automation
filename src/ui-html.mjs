export function injectBeforeClosingTag(html, tagName, payload) {
  const source = String(html);
  const marker = `</${tagName}>`;
  return source.includes(marker)
    ? source.replace(marker, `${payload}${marker}`)
    : `${source}${payload}`;
}

export function injectIntoHead(html, payload) {
  return injectBeforeClosingTag(html, 'head', payload);
}

export function injectIntoBody(html, payload) {
  return injectBeforeClosingTag(html, 'body', payload);
}

export function replaceRequiredHtml(html, marker, replacement, label = marker) {
  const source = String(html);
  if (!source.includes(marker)) throw new Error(`Required UI composition marker was not found: ${label}`);
  return source.replace(marker, replacement);
}
