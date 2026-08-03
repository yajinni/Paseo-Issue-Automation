import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatGptConversationUrl, sameConversationUrl } from '../src/chatgpt-url.mjs';

test('conversation URLs require HTTPS, an allowed host, and a conversation path', () => {
  assert.equal(normalizeChatGptConversationUrl('https://chatgpt.com/c/abc-123?utm_source=x#frag'), 'https://chatgpt.com/c/abc-123');
  assert.equal(normalizeChatGptConversationUrl('https://chat.openai.com/c/abc'), 'https://chatgpt.com/c/abc');
  assert.throws(() => normalizeChatGptConversationUrl('http://chatgpt.com/c/abc'), /HTTPS/);
  assert.throws(() => normalizeChatGptConversationUrl('https://evil.example/c/abc'), /Unsupported/);
  assert.throws(() => normalizeChatGptConversationUrl('https://chatgpt.com/'), /specific ChatGPT conversation/);
  assert.throws(() => normalizeChatGptConversationUrl('https://user:pass@chatgpt.com/c/abc'), /credentials/);
});

test('conversation comparison ignores tracking data and legacy host', () => {
  assert.equal(sameConversationUrl('https://chat.openai.com/c/abc?x=1', 'https://chatgpt.com/c/abc'), true);
  assert.equal(sameConversationUrl('https://chatgpt.com/c/abc', 'https://chatgpt.com/c/other'), false);
});
