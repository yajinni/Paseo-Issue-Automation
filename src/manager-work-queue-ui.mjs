import { injectIntoBody, injectIntoHead } from './ui-html.mjs';
import {
  MANAGER_EXPANDED_SIDE_ACTIONS_SCRIPT,
  MANAGER_EXPANDED_SIDE_ACTIONS_STYLE,
} from './manager-expanded-side-actions-ui.mjs';
import {
  MANAGER_LIFECYCLE_CARDS_SCRIPT,
  MANAGER_LIFECYCLE_CARDS_STYLE,
} from './manager-lifecycle-cards-ui.mjs';
import { MANAGER_PR_HEALTH_STYLE } from './manager-pr-health-ui-style.mjs';
import { MANAGER_PR_RECOVERY_STYLE } from './manager-pr-recovery-ui-style.mjs';
import { MANAGER_WORK_QUEUE_STYLE as BASE_MANAGER_WORK_QUEUE_STYLE } from './manager-work-queue-ui-style.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_1 } from './manager-work-queue-ui-script-part-1.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_2 } from './manager-work-queue-ui-script-part-2.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_3 } from './manager-work-queue-ui-script-part-3.mjs';
import { MANAGER_WORK_QUEUE_SCRIPT_PART_4 } from './manager-work-queue-ui-script-part-4.mjs';
import {
  MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT,
  MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE,
} from './manager-work-queue-table-polish-ui.mjs';

export const MANAGER_WORK_QUEUE_STYLE = BASE_MANAGER_WORK_QUEUE_STYLE
  + MANAGER_PR_HEALTH_STYLE
  + MANAGER_PR_RECOVERY_STYLE
  + MANAGER_EXPANDED_SIDE_ACTIONS_STYLE
  + MANAGER_LIFECYCLE_CARDS_STYLE
  + MANAGER_WORK_QUEUE_TABLE_POLISH_STYLE;
export const MANAGER_WORK_QUEUE_SCRIPT = [
  MANAGER_WORK_QUEUE_SCRIPT_PART_1,
  MANAGER_WORK_QUEUE_SCRIPT_PART_2,
  MANAGER_WORK_QUEUE_SCRIPT_PART_3,
  MANAGER_WORK_QUEUE_SCRIPT_PART_4,
  MANAGER_EXPANDED_SIDE_ACTIONS_SCRIPT,
  MANAGER_LIFECYCLE_CARDS_SCRIPT,
  MANAGER_WORK_QUEUE_TABLE_POLISH_SCRIPT,
].join('');

export function enhanceManagerWithWorkQueue(html) {
  const themed = injectIntoHead(html, `<style data-manager-work-queue-style>${MANAGER_WORK_QUEUE_STYLE}</style>`);
  return injectIntoBody(themed, `<script data-manager-work-queue>${MANAGER_WORK_QUEUE_SCRIPT}</script>`);
}