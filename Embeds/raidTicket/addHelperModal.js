import {
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';

export const ADD_HELPER_MODAL_ID = 'addRaidHelperModal';

export function buildAddHelperModal({ maxSelectable = 6 } = {}) {
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('addHelperUsers')
    .setPlaceholder('Search and select helpers…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(maxSelectable, 25)));

  const userLabel = new LabelBuilder()
    .setLabel('Helpers to add')
    .setDescription('Search by name. Only members with the warrior role can be added.')
    .setUserSelectMenuComponent(userSelect);

  return new ModalBuilder()
    .setCustomId(ADD_HELPER_MODAL_ID)
    .setTitle('Add Helper')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'Select one or more warriors to add to this raid ticket.',
      ),
    )
    .addLabelComponents(userLabel);
}

export function getAddHelperUserIds(interaction) {
  return interaction.fields?.getSelectedUsers?.('addHelperUsers')?.map((user) => user.id) ?? [];
}
