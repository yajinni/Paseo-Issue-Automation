const SUPPORTED_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);

export function normalizeChatGptConversationUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('A ChatGPT conversation URL is required.');
  let url;
  try { url = new URL(input); } catch { throw new Error('The ChatGPT conversation URL is invalid.'); }
  if (url.protocol !== 'https:') throw new Error('ChatGPT conversation URLs must use HTTPS.');
  if (url.username || url.password) throw new Error('ChatGPT conversation URLs may not contain embedded credentials.');
  const host = url.hostname.toLowerCase();
  if (!SUPPORTED_HOSTS.has(host)) throw new Error(`Unsupported ChatGPT host: ${host}`);
  const path = url.pathname.replace(/\/+$/, '');
  const conversationPath = /^\/c\/[A-Za-z0-9_-]+$/.test(path)
    || /^\/g\/[A-Za-z0-9_-]+\/c\/[A-Za-z0-9_-]+$/.test(path);
  if (!conversationPath) throw new Error('The URL must identify a specific ChatGPT conversation.');
  const canonicalHost = host === 'chat.openai.com' || host === 'www.chatgpt.com' ? 'chatgpt.com' : host;
  return `https://${canonicalHost}${path}`;
}

export function sameConversationUrl(left, right) {
  try { return normalizeChatGptConversationUrl(left) === normalizeChatGptConversationUrl(right); }
  catch { return false; }
}

export function isLoginOrHomeUrl(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return path === '/' || /^\/(auth|login|signup)(\/|$)/i.test(path);
  } catch { return true; }
}

export function supportedChatGptHosts() {
  return [...SUPPORTED_HOSTS];
}
