import { injectIntoBody, injectIntoHead } from './ui-html.mjs';
import { MANAGER_WORK_QUEUE_STYLE } from './manager-work-queue-ui-style.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_1 } from './manager-work-queue-ui-script-part-1.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_2 } from './manager-work-queue-ui-script-part-2.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_3 } from './manager-work-queue-ui-script-part-3.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_4 } from './manager-work-queue-ui-script-part-4.mjs';

export { MANAGER_WORK_QUEUE_STYLE };
export const MANAGER_WORK_QUEUE_SCRIPT = [
  MANAGER_WORK_QUEUE_SCRIPT_PART_1,
  MANAGER_WORK_QUEUE_SCRIPT_PART_2,
  MANAGER_WORK_QUEUE_SCRIPT_PART_3,
  MANAGER_WORK_QUEUE_SCRIPT_PART_4,
].join('');

export function enhanceManagerWithWorkQueue(html) {
  const themed = injectIntoHead(html, `<style data-manager-work-queue-style>${MANAGER_WORK_QUEUE_STYLE}</style>`);
  return injectIntoBody(themed, `<script data-manager-work-queue>${MANAGER_WORK_QUEUE_SCRIPT}</script>`);
}
