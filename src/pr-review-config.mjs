import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';
import { savePrAutomationConfig } from './pr-review-store.mjs';

export function saveValidatedPrAutomationConfig(root, input = {}) {
  const projectUrl = input.browserReview?.projectConversationUrl;
  const normalized = projectUrl
    ? normalizeChatGptConversationUrl(projectUrl)
    : projectUrl === null ? null : undefined;
  return savePrAutomationConfig(root, {
    ...input,
    browserReview: {
      ...(input.browserReview || {}),
      ...(normalized !== undefined ? { projectConversationUrl: normalized } : {}),
    },
  });
}
