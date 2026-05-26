import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import {
  EMBED_COLOR,
  RAID_STATUS,
  STATUS_COLORS,
} from '../../config/constants.js';
import {
  addHelperButton,
  cancelTicketButton,
  closeTicketButton,
  editDescriptionButton,
  editServerButton,
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

function getRequesterDisplay(requester) {
  return requester?.displayName || requester?.user?.globalName || requester?.user?.username || requester?.tag || requester?.id || 'Requester';
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

function formatPartialHelperMentions(helpers = []) {
  if (!helpers.length) return '*None yet*';
  return helpers.map((helper) => `* <@${helper.helperId}>`).join('\n');
}

function addHelperSections(container, helpers, { isClosing, includeTime = false }) {
  helpers.slice(0, 10).forEach((helper, index) => {
    if (isClosing) {
      const duration = includeTime ? formatDuration(helper.joinedAt, helper.removedAt || new Date()) : null;
      const body = `<@${helper.helperId}>${duration ? `\n- Time: ${duration}` : ''}`;
      container.addTextDisplayComponents(text(body));
      container.addActionRowComponents(getHelperControlRow(helper, { showTaskHelped: true }));
      return;
    }

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
  const activeHelpers = helpers.filter((helper) => !helper.removedAt);
  const midRunPartials = helpers.filter((helper) => helper.removedAt);
  const displayName = getRequesterDisplay(requester);
  const status = raidInfo?.status || RAID_STATUS.WAITING;
  const helperCapacity = getRaidHelperCapacity(raidInfo);
  const includeTime = isClosing && isSpammingRaid(raidInfo);

  const mainContainer = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS?.[status] ?? EMBED_COLOR)
    .addTextDisplayComponents(text(`### ${displayName}`))
    .addSectionComponents(
      section(`**Task**\n${taskFieldValue}`, editTasksButton),
      section(`**Server**\n${raidInfo?.server || 'None'}`, editServerButton),
      section('**Description**\n*Posted in a separate message below.*', editDescriptionButton),
      section('**Ping Helpers**\nRemind joined helpers (once every 30 minutes).', pingHelpersButton),
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
      addHelperSections(mainContainer, activeHelpers, { isClosing: false });
    }

    if (midRunPartials.length) {
      mainContainer.addTextDisplayComponents(
        text(`**Partial Helpers**\n${formatPartialHelperMentions(midRunPartials)}`),
      );
    }

    mainContainer.addActionRowComponents(buildMainActionRow());
  } else {
    mainContainer
      .addTextDisplayComponents(text('**Status**\nAwaiting Completion'))
      .addTextDisplayComponents(text(`**Helpers: ${activeHelpers.length}/${helperCapacity}**`));

    if (!activeHelpers.length) {
      mainContainer.addTextDisplayComponents(text('No helpers yet.'));
    } else {
      addHelperSections(mainContainer, activeHelpers, { isClosing: true, includeTime });
    }

    if (midRunPartials.length) {
      mainContainer.addTextDisplayComponents(
        text(`**Partial Helpers**\n${formatPartialHelperMentions(midRunPartials)}`),
      );
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
