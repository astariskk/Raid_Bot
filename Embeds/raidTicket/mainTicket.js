import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { EMBED_COLOR, RAID_STATUS, STATUS_COLORS } from '../../config/constants.js';
import {
  addHelperButton,
  attachTasksButton,
  cancelTicketButton,
  closeTicketButton,
  editDescriptionButton,
  editMapServerButton,
  editTasksButton,
  getCloseConfirmRow,
  getKickHelperSelectRow,
  joinTicketButton,
  pingHelpersButton,
  raidmapsButton,
} from '../../handlers/raidTickets/buttons/threadButtons.js';
import {
  formatActiveHelperEmbedLines,
  formatPartialHelperEmbedLines,
} from '../../handlers/raidTickets/domain/partialHelpers.js';
import { CLOSE_HELPER_HINT, HELPER_MANAGEMENT_HINT } from './constants.js';
import {
  getRaidHelperCapacity,
  getRaidTaskFieldDisplay,
} from '../../handlers/raidTickets/raidTicketLogic.js';

function text(content) {
  return new TextDisplayBuilder().setContent(String(content || '\u200b').slice(0, 4000));
}

function section(content, button) {
  const builder = new SectionBuilder().addTextDisplayComponents(text(content));
  if (button) builder.setButtonAccessory(button);
  return builder;
}

function separator() {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

function buildMainActionRow() {
  return new ActionRowBuilder().addComponents(
    joinTicketButton,
    raidmapsButton,
    closeTicketButton,
    cancelTicketButton,
  );
}

function formatMapServerBody(raidInfo) {
  return `**Server**\n${raidInfo?.server || 'None'}`;
}

function getCurrentHelpersLabel(count) {
  return count === 1 ? 'Current Helper' : 'Current Helpers';
}

function addCurrentHelpersSection(container, { activeHelpers, helperCapacity, isClosing, raidInfo }) {
  const label = getCurrentHelpersLabel(activeHelpers.length);
  const header = `**${label}: ${activeHelpers.length}/${helperCapacity}**`;
  if (isClosing) {
    container.addTextDisplayComponents(text(header));
  } else {
    container.addSectionComponents(section(header, addHelperButton));
  }
  container.addTextDisplayComponents(text(formatActiveHelperEmbedLines(activeHelpers, raidInfo)));

  if (!isClosing) {
    const kickSelectRow = getKickHelperSelectRow(activeHelpers);
    if (kickSelectRow) {
      container.addActionRowComponents(kickSelectRow);
    }
  }
}

function addPartialHelpersSection(container, { midRunPartials, raidInfo }) {
  if (!midRunPartials.length) return;
  container.addSectionComponents(section('**Partial Helpers**', attachTasksButton));
  container.addTextDisplayComponents(
    text(formatPartialHelperEmbedLines(midRunPartials, raidInfo?.partialHelpers, raidInfo).slice(0, 4000)),
  );
}

export function buildMainTicketMessagePayload({ requester, raidInfo, helpers = [], isClosing }) {
  const closing = isClosing ?? Boolean(raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION);
  return buildRaidRequestComponentsV2({ requester, raidInfo, helpers, isClosing: closing });
}

function buildRaidRequestComponentsV2({ requester, raidInfo, helpers = [], isClosing }) {
  const taskFieldValue = getRaidTaskFieldDisplay(raidInfo?.task);
  const activeHelpers = helpers.filter((helper) => !helper.removedAt);
  const midRunPartials = helpers.filter((helper) => helper.removedAt);
  const status = raidInfo?.status || RAID_STATUS.WAITING;
  const helperCapacity = getRaidHelperCapacity(raidInfo);

  const mainContainer = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS?.[status] ?? EMBED_COLOR)
    .addTextDisplayComponents(text('### Raid Request Details'))
    .addSectionComponents(
      section(`**Task**\n${taskFieldValue}`, editTasksButton),
      section(formatMapServerBody(raidInfo), editMapServerButton),
      section(`**Description**\n${raidInfo?.description || 'No description provided.'}`, editDescriptionButton),
      section('**Ping Helpers**\nPing the Warrior role (once every 30 minutes since the last role ping).', pingHelpersButton),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(isClosing ? CLOSE_HELPER_HINT : HELPER_MANAGEMENT_HINT));

  if (!isClosing) {
    mainContainer.addTextDisplayComponents(text(`**Current Status**\n${status}`));
    addCurrentHelpersSection(mainContainer, { activeHelpers, helperCapacity, isClosing: false, raidInfo });
    addPartialHelpersSection(mainContainer, { midRunPartials, raidInfo });
    mainContainer.addActionRowComponents(buildMainActionRow());
  } else {
    mainContainer.addTextDisplayComponents(text('**Status**\nAwaiting Completion'));
    addCurrentHelpersSection(mainContainer, { activeHelpers, helperCapacity, isClosing: true, raidInfo });
    addPartialHelpersSection(mainContainer, { midRunPartials, raidInfo });
    mainContainer.addActionRowComponents(getCloseConfirmRow({ proofImageUrl: raidInfo?.proofImage }));
  }

  return {
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
    components: [mainContainer],
  };
}
