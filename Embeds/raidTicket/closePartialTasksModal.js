import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { TASK_DISPLAY_NAMES } from '../../config/constants.js';

export const CLOSE_PARTIAL_TASKS_MODAL_ID = 'closePartialTasksModal';

function buildTaskSelect(helperId, taskKeys) {
  const keys = [...new Set((taskKeys || []).map((key) => String(key).toLowerCase()).filter(Boolean))].slice(0, 24);

  return new StringSelectMenuBuilder()
    .setCustomId(`closePartialTasks_${helperId}`)
    .setPlaceholder('Select tasks this helper covered…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, keys.length))
    .addOptions(
      [
        new StringSelectMenuOptionBuilder().setLabel('No task helped').setValue('__none__').setDescription('This helper did not help with any tasks'),
        ...keys.map((key) => new StringSelectMenuOptionBuilder()
          .setLabel(String(TASK_DISPLAY_NAMES?.[key] ?? key).slice(0, 100))
          .setValue(key)),
      ],
    );
}

/** Up to 4 partial helpers per modal (Discord modal component limit). */
export function buildClosePartialTasksModal(helpersMissing = [], taskKeys = []) {
   const modal = new ModalBuilder()
     .setCustomId(CLOSE_PARTIAL_TASKS_MODAL_ID)
     .setTitle('Partial helper tasks');

   modal.addTextDisplayComponents(
     new TextDisplayBuilder().setContent(
       'These helpers left before the raid was closed. Select which tasks each one helped with, then submit to finish closing.',
     ),
   );

for (const helper of helpersMissing.slice(0, 4)) {
      const helperId = String(helper?.helperId ?? helper?.id ?? '').trim();
      const displayName = String(helper?.displayName ?? helper?.name ?? helperId).trim();
      if (!helperId) continue;

      modal.addLabelComponents(
        new LabelBuilder()
          .setLabel(`Helper: ${displayName}`)
          .setStringSelectMenuComponent(buildTaskSelect(helperId, taskKeys)),
      );
    }

   return modal;
}

export function getClosePartialTasksSelections(interaction, helperIds = []) {
  const selections = {};
  for (const helperId of helperIds) {
    const id = String(helperId).trim();
    if (!id) continue;
    selections[id] = interaction.fields?.getStringSelectValues?.(`closePartialTasks_${id}`) ?? [];
  }
  return selections;
}
