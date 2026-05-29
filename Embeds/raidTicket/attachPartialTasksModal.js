import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { TASK_DISPLAY_NAMES } from '../../config/constants.js';

export const ATTACH_PARTIAL_TASKS_MODAL_ID = 'attachPartialTasksModal';

export function buildAttachPartialTasksModal(partialHelpers, taskKeys) {
  const helpers = (partialHelpers || [])
    .map((entry) => ({
      helperId: String(entry?.helperId ?? entry ?? '').trim(),
      displayName: String(entry?.displayName ?? '').trim(),
    }))
    .filter((entry) => entry.helperId)
    .slice(0, 25);
  const keys = [...new Set((taskKeys || []).map((key) => String(key).toLowerCase()).filter(Boolean))].slice(0, 24);

  const helperSelect = new StringSelectMenuBuilder()
    .setCustomId('attachPartialHelpers')
    .setPlaceholder('Select partial helper(s)…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, helpers.length))
    .addOptions(
      helpers.map(({ helperId, displayName }) => new StringSelectMenuOptionBuilder()
        .setLabel((displayName || `Helper ${helperId}`).slice(0, 100))
        .setValue(helperId)
        .setDescription('Partial helper who left the raid'.slice(0, 100))),
    );

  const taskSelect = new StringSelectMenuBuilder()
    .setCustomId('attachPartialTasks')
    .setPlaceholder('Select task(s) they helped with…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, keys.length))
    .addOptions(
      keys.map((key) => new StringSelectMenuOptionBuilder()
        .setLabel(String(TASK_DISPLAY_NAMES?.[key] ?? key).slice(0, 100))
        .setValue(key)),
    );

  return new ModalBuilder()
    .setCustomId(ATTACH_PARTIAL_TASKS_MODAL_ID)
    .setTitle('Attach Tasks')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'Assign tasks to partial helpers who left or were removed. On spamming raids, time in ticket is recorded when you attach tasks.',
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Partial helper(s)')
        .setDescription('Who should receive these tasks?')
        .setStringSelectMenuComponent(helperSelect),
      new LabelBuilder()
        .setLabel('Tasks')
        .setDescription('Which raid tasks did they help with?')
        .setStringSelectMenuComponent(taskSelect),
    );
}

export function getAttachPartialTasksSelections(interaction) {
  const helperIds = interaction.fields?.getStringSelectValues?.('attachPartialHelpers') ?? [];
  const tasks = interaction.fields?.getStringSelectValues?.('attachPartialTasks') ?? [];
  return { helperIds, tasks };
}
