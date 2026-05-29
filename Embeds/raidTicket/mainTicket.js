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
import { CLOSE_HELPER_HINT, HELPER_MANAGEMENT_HINT } from './constants.js';
import {
  getRaidHelperCapacity,
  getRaidTaskFieldDisplay,
  isSpammingRaid,
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

function getPartialHelperTaskLabel(helper, partialHelpers) {
  const entry = partialHelpers.find((e) => String(e.helperId) === String(helper.helperId));
  if (entry?.tasks?.length) return getRaidTaskFieldDisplay(entry.tasks.join(', '));
  return 'No Task Helped';
}

function formatHelperLines(helpers) {
  if (!helpers.length) return 'No helpers yet.';
  return helpers.map((helper) => `<@${helper.helperId}>`).join('\n');
}

function formatPartialHelperLines(helpers, partialHelpers) {
  if (!helpers.length) return '';
  return helpers
    .map((helper) => {
      const tasks = getPartialHelperTaskLabel(helper, partialHelpers);
      return `* <@${helper.helperId}>: ${tasks}`;
    })
    .join('\n');
}

function getCurrentHelpersLabel(count) {
  return count === 1 ? 'Current Helper' : 'Current Helpers';
}

function addCurrentHelpersSection(container, { activeHelpers, helperCapacity, isClosing }) {
  const label = getCurrentHelpersLabel(activeHelpers.length);
  const header = `**${label}: ${activeHelpers.length}/${helperCapacity}**`;
  if (isClosing) {
    container.addTextDisplayComponents(text(header));
  } else {
    container.addSectionComponents(section(header, addHelperButton));
  }
  container.addTextDisplayComponents(text(formatHelperLines(activeHelpers)));

  if (!isClosing) {
    const kickSelectRow = getKickHelperSelectRow(activeHelpers);
    if (kickSelectRow) {
      container.addActionRowComponents(kickSelectRow);
    }
  }
}

function addPartialHelpersSection(container, { midRunPartials, partialHelpers }) {
  if (!midRunPartials.length) return;
  container.addSectionComponents(
    section('**Partial Helpers**', attachTasksButton),
  );
  container.addTextDisplayComponents(
    text(formatPartialHelperLines(midRunPartials, partialHelpers).slice(0, 4000)),
  );
}

export function buildMainTicketMessagePayload({ requester, raidInfo, helpers = [], isClosing }) {
  const closing = isClosing ?? Boolean(raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION);
  return buildRaidRequestComponentsV2({ requester, raidInfo, helpers, isClosing: closing });
}

function buildRaidRequestComponentsV2({ requester, raidInfo, helpers = [], isClosing }) {
  const taskFieldValue = getRaidTaskFieldDisplay(raidInfo?.task);
  const partialHelpers = Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [];
  const activeHelpers = helpers.filter((helper) => !helper.removedAt);
  const midRunPartials = helpers.filter((helper) => helper.removedAt);
  const status = raidInfo?.status || RAID_STATUS.WAITING;
  const helperCapacity = getRaidHelperCapacity(raidInfo);
  const spamming = isSpammingRaid(raidInfo);

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
    addCurrentHelpersSection(mainContainer, { activeHelpers, helperCapacity, isClosing: false });

    if (spamming) {
      addPartialHelpersSection(mainContainer, { midRunPartials, partialHelpers });
    }

    mainContainer.addActionRowComponents(buildMainActionRow());
  } else {
    mainContainer
      .addTextDisplayComponents(text('**Status**\nAwaiting Completion'));
    addCurrentHelpersSection(mainContainer, { activeHelpers, helperCapacity, isClosing: true });

    if (spamming) {
      addPartialHelpersSection(mainContainer, { midRunPartials, partialHelpers });
    }

    mainContainer.addActionRowComponents(getCloseConfirmRow({ proofImageUrl: raidInfo?.proofImage }));
  }

  return {
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
    components: [mainContainer],
  };
}
