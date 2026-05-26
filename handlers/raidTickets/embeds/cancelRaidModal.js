import {
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const CANCEL_RAID_MODAL_ID = 'confirmCancelRaidModal';

export function buildCancelRaidConfirmModal() {
  const dummyInput = new TextInputBuilder()
    .setCustomId('cancelRaidDummy')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('You can leave this blank');

  const dummyLabel = new LabelBuilder()
    .setLabel('You can leave this blank')
    .setTextInputComponent(dummyInput);

  return new ModalBuilder()
    .setCustomId(CANCEL_RAID_MODAL_ID)
    .setTitle('Cancel Raid')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'Are you sure you want to cancel this raid? This will close the ticket and notify staff for review.\n\nPress **Submit** to cancel the raid. Close this window to keep the raid open.',
      ),
    )
    .addLabelComponents(dummyLabel);
}
