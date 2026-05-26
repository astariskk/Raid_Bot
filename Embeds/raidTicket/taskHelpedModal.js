import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { TASK_DISPLAY_NAMES } from '../../config/constants.js';

export function getTaskHelpedModalId(helperId) {
  return `taskHelpedModal_${helperId}`;
}

export function buildTaskHelpedModal(helperId, taskKeys, selectedTasks = []) {
  const selectedSet = new Set((selectedTasks || []).map((task) => String(task).toLowerCase()));
  const keys = [...new Set((taskKeys || []).map((key) => String(key).toLowerCase()).filter(Boolean))].slice(0, 24);

  const taskSelect = new StringSelectMenuBuilder()
    .setCustomId('taskHelpedTasks')
    .setPlaceholder('Select tasks this helper covered…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, keys.length))
    .addOptions(
      [
        new StringSelectMenuOptionBuilder().setLabel('No task helped').setValue('__none__').setDescription('This helper did not help with any tasks'),
        ...keys.map((key) => new StringSelectMenuOptionBuilder()
          .setLabel(String(TASK_DISPLAY_NAMES?.[key] ?? key).slice(0, 100))
          .setValue(key)
          .setDefault(selectedSet.has(key))),
      ],
    );

  const taskLabel = new LabelBuilder()
    .setLabel('Tasks covered')
    .setDescription('Choose every task this helper participated in.')
    .setStringSelectMenuComponent(taskSelect);

  return new ModalBuilder()
    .setCustomId(getTaskHelpedModalId(helperId))
    .setTitle('Task Helped')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Assign partial credit for <@${helperId}> when they only covered part of a mixed-size raid.`,
      ),
    )
    .addLabelComponents(taskLabel);
}

export function getTaskHelpedModalSelections(interaction) {
  return interaction.fields?.getStringSelectValues?.('taskHelpedTasks') ?? [];
}
