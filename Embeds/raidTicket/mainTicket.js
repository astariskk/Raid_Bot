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
  cancelTicketButton,
  closeTicketButton,
  editDescriptionButton,
  editMapServerButton,
  editTasksButton,
  getCloseConfirmRow,
  getHelperControlRow,
  getKickHelperButton,
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
  return new ActionRowBuilder().addComponents(joinTicketButton, raidmapsButton, closeTicketButton, cancelTicketButton);
}

function formatDuration(startValue, endValue = new Date()) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue || new Date()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const minutes = Math.max(1, Math.floor((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return `${hours}h ${remainder}m`;
  return `${minutes}m`;
}

function formatMapServerBody(raidInfo) {
  return `**Server**\n${raidInfo?.server || 'None'}`;
}

function getHelperTaskLabel(helper, partialHelpers, { isPartial = false } = {}) {
  if (!isPartial) return 'All tasks';
  const entry = partialHelpers.find((e) => String(e.helperId) === String(helper.helperId));
  if (entry?.tasks?.length) return getRaidTaskFieldDisplay(entry.tasks.join(', '));
  return 'Partial tasks';
}

function addClosingHelperRow(container, helper, { partialHelpers, showSpamTime }) {
  const isPartial = Boolean(helper.removedAt);
  const taskLabel = getHelperTaskLabel(helper, partialHelpers, { isPartial });
  container.addTextDisplayComponents(text(`<@${helper.helperId}> : ${taskLabel}`));
  container.addActionRowComponents(getHelperControlRow(helper, { showTaskHelped: true }));

  if (showSpamTime) {
    const duration = formatDuration(helper.joinedAt, helper.removedAt || new Date());
    if (duration) {
      container.addTextDisplayComponents(text(`  * time spent: ${duration}`));
    }
  }
}

function addActiveHelperSections(container, helpers) {
  helpers.slice(0, 10).forEach((helper, index) => {
    container.addSectionComponents(
      section(`<@${helper.helperId}>`, getKickHelperButton(helper, `Helper ${index + 1}`)),
    );
  });
}

export function buildMainTicketMessagePayload({ requester, raidInfo, helpers = [], isClosing }) {
  const closing = isClosing ?? Boolean(raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION);
  const payload = buildRaidRequestComponentsV2({ requester, raidInfo, helpers, isClosing: closing });
  return payload;
}

function buildRaidRequestComponentsV2({ requester, raidInfo, helpers = [], isClosing }) {
  const taskFieldValue = getRaidTaskFieldDisplay(raidInfo?.task);
  const partialHelpers = Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [];
  const activeHelpers = helpers.filter((helper) => !helper.removedAt);
  const midRunPartials = helpers.filter((helper) => helper.removedAt);
  const status = raidInfo?.status || RAID_STATUS.WAITING;
  const helperCapacity = getRaidHelperCapacity(raidInfo);
  const showSpamTime = isClosing && isSpammingRaid(raidInfo);

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

    mainContainer.addSectionComponents(
      section(`**Helpers: ${activeHelpers.length}/${helperCapacity}**`, addHelperButton),
    );

    if (!activeHelpers.length) {
      mainContainer.addTextDisplayComponents(text('No helpers yet.'));
    } else {
      addActiveHelperSections(mainContainer, activeHelpers);
    }

    if (midRunPartials.length) {
      mainContainer.addTextDisplayComponents(text('**Partial Helpers**'));
      midRunPartials.slice(0, 10).forEach((helper) => {
        mainContainer.addTextDisplayComponents(text(`<@${helper.helperId}>`));
        mainContainer.addActionRowComponents(getHelperControlRow(helper, { showTaskHelped: true }));
      });
    }

    mainContainer.addActionRowComponents(buildMainActionRow());
  } else {
    mainContainer
      .addTextDisplayComponents(text('**Status**\nAwaiting Completion'))
      .addTextDisplayComponents(text(`**Helpers: ${activeHelpers.length}/${helperCapacity}**`));

    if (!activeHelpers.length) {
      mainContainer.addTextDisplayComponents(text('No helpers yet.'));
    } else {
      activeHelpers.slice(0, 10).forEach((helper) => {
        addClosingHelperRow(mainContainer, helper, { partialHelpers, showSpamTime });
      });
    }

    if (midRunPartials.length) {
      mainContainer.addTextDisplayComponents(text('**Partial Helpers**'));
      midRunPartials.slice(0, 10).forEach((helper) => {
        addClosingHelperRow(mainContainer, helper, { partialHelpers, showSpamTime });
      });
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
