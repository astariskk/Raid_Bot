import {
  ActionRowBuilder,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { EMBED_COLOR, RAID_HELPER_ROLE_ID, RAID_STATUS, STATUS_COLORS, TASK_CATEGORY_BY_TASK, TASK_DISPLAY_NAMES } from '../../config/constants.js';
import {
  cancelTicketButton,
  closeTicketButton,
  editDescriptionButton,
  editServerButton,
  editTasksButton,
  getCloseConfirmRow,
  getKickHelperButton,
  joinTicketButton,
  raidmapsButton,
} from './buttons/threadButtons.js';

export const SPAMMING_TASK_KEY = 'spamming';
export const SPAMMING_RATE_PER_MINUTE = 300;
export const SPAMMING_EXP_CAP = 10000;

export function getTaskKeys(taskString = '') {
  return String(taskString ?? '')
    .split(/\s*[+,]\s*/)
    .map((task) => task.trim().toLowerCase())
    .filter(Boolean);
}

export function getTaskDisplayNames(taskStringOrTasks = '') {
  const tasks = Array.isArray(taskStringOrTasks) ? taskStringOrTasks : getTaskKeys(taskStringOrTasks);
  return tasks.map((task) => TASK_DISPLAY_NAMES?.[task] ?? task);
}

export function isSpammingRaid(raidInfoOrTasks) {
  const tasks = Array.isArray(raidInfoOrTasks)
    ? raidInfoOrTasks
    : getTaskKeys(raidInfoOrTasks?.task || raidInfoOrTasks?.tasks || '');
  return tasks.map((task) => String(task).toLowerCase()).includes(SPAMMING_TASK_KEY);
}

export function getNormalTaskString(taskString = '') {
  return getTaskKeys(taskString).filter((task) => task !== SPAMMING_TASK_KEY).join(', ');
}

export function getRaidStatusForHelpers({ isSpamming, helperCount, maxHelpers = 4 }) {
  if (!isSpamming) return RAID_STATUS.WAITING;
  if (helperCount >= maxHelpers) return RAID_STATUS.FULL;
  if (helperCount > 1) return RAID_STATUS.ONGOING;
  return RAID_STATUS.WAITING;
}

function getRequesterDisplay(requester) {
  return requester?.displayName || requester?.user?.globalName || requester?.user?.username || requester?.tag || requester?.id || 'Requester';
}

function getRequesterAvatar(requester) {
  return requester?.displayAvatarURL?.() || requester?.user?.displayAvatarURL?.() || null;
}

function getVisibleHelpers(helpers = [], requesterId = null) {
  return helpers.filter((helper) => String(helper?.helperId ?? '') && String(helper.helperId) !== String(requesterId ?? ''));
}

export function getRaidPartySize(raidInfoOrTasks) {
  const tasks = Array.isArray(raidInfoOrTasks)
    ? raidInfoOrTasks
    : getTaskKeys(raidInfoOrTasks?.task || raidInfoOrTasks?.tasks || '');
  const categories = tasks.map((task) => TASK_CATEGORY_BY_TASK?.[task]).filter(Boolean);
  if (categories.some((category) => ['originul', 'legion', 'other_seven', 'generic'].includes(category))) return 7;
  return 4;
}

export function getRaidHelperCapacity(raidInfoOrTasks) {
  return Math.max(1, getRaidPartySize(raidInfoOrTasks) - 1);
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

function formatHelperLines(helpers = [], { includeTime = false } = {}) {
  if (!helpers.length) return 'No helpers yet.';
  return helpers
    .map((helper) => {
      const duration = includeTime ? formatDuration(helper.joinedAt, helper.removedAt || new Date()) : null;
      const timeLine = duration ? `\n- Time: ${duration}` : '';
      return `<@${helper.helperId}>${timeLine}`;
    })
    .join('\n');
}

export function buildRaidRequestEmbeds({ requester, raidInfo, helpers = [] }) {
  const displayTasks = getTaskDisplayNames(raidInfo?.task);
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  const activeHelpers = visibleHelpers.filter((helper) => !helper.removedAt);
  const removedHelpers = visibleHelpers.filter((helper) => helper.removedAt);
  const storedStatus = raidInfo?.status || RAID_STATUS.WAITING;
  const status = storedStatus;
  const color = STATUS_COLORS?.[status] ?? EMBED_COLOR;
  const displayName = getRequesterDisplay(requester);
  const avatar = getRequesterAvatar(requester);
  const helperCapacity = getRaidHelperCapacity(raidInfo);
  const isClosing = Boolean(raidInfo?.isAwaitingCompletion || status === RAID_STATUS.AWAITING_COMPLETION);
  const includeTime = isClosing && isSpammingRaid(raidInfo);

  const detailsEmbed = new EmbedBuilder()
    .setColor(color)
    .setAuthor(avatar ? { name: displayName, iconURL: avatar } : { name: displayName })
    .addFields(
      {
        name: displayTasks.length === 1 ? 'Task' : 'Tasks',
        value: displayTasks.length ? displayTasks.join(', ') : 'None',
        inline: false,
      },
      {
        name: 'Server',
        value: raidInfo?.server || 'None',
        inline: false,
      },
      {
        name: 'Description',
        value: raidInfo?.description || 'No description provided.',
        inline: false,
      },
    );

  const statusEmbed = new EmbedBuilder()
    .setColor(color);

if (!isClosing) {
     statusEmbed
       .addFields(
         { name: 'Current Status', value: status, inline: false },
         { name: `Helpers: ${activeHelpers.length}/${helperCapacity}`, value: formatHelperLines(activeHelpers), inline: false },
       )
       .addFields({ name: '\u200b', value: 'You can type `!waiting`, `!ongoing`, or `!full` to update the raid status. Status will also update automatically for spamming raids.\nUse the buttons below to manage your raid.', inline: false });
     return [detailsEmbed, statusEmbed];
  }

  statusEmbed.addFields(
    { name: 'Status', value: 'Awaiting Completion', inline: false },
    { name: `Helpers: ${activeHelpers.length}/${helperCapacity}`, value: formatHelperLines(activeHelpers, { includeTime }), inline: false },
  );

  if (removedHelpers.length) {
    statusEmbed.addFields({
      name: 'Partial Helpers',
      value: formatHelperLines(removedHelpers, { includeTime }),
      inline: false,
    });
  }

  return [detailsEmbed, statusEmbed];
}

export function buildRaidRequestMessagePayload({ requester, raidInfo, helpers = [] }) {
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  const isClosing = Boolean(raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION);
  return buildRaidRequestComponentsV2({ requester, raidInfo, helpers: visibleHelpers, isClosing });
}

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
  return new ActionRowBuilder().addComponents(joinTicketButton, closeTicketButton, cancelTicketButton, raidmapsButton);
}

function buildRaidRequestComponentsV2({ requester, raidInfo, helpers = [], isClosing }) {
  const displayTasks = getTaskDisplayNames(raidInfo?.task);
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  const activeHelpers = visibleHelpers.filter((helper) => !helper.removedAt);
  const removedHelpers = visibleHelpers.filter((helper) => helper.removedAt);
  const displayName = getRequesterDisplay(requester);
  const status = raidInfo?.status || RAID_STATUS.WAITING;
  const helperCapacity = getRaidHelperCapacity(raidInfo);
  const includeTime = isClosing && isSpammingRaid(raidInfo);

  const container = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS?.[status] ?? EMBED_COLOR)
    .addTextDisplayComponents(text(`<@&${RAID_HELPER_ROLE_ID}> New raid request from <@${raidInfo?.requesterId}>`))
    .addTextDisplayComponents(text(`### ${displayName}`))
    .addSectionComponents(
      section(`**${displayTasks.length === 1 ? 'Task' : 'Tasks'}**\n${displayTasks.length ? displayTasks.join(', ') : 'None'}`, editTasksButton),
      section(`**Server**\n${raidInfo?.server || 'None'}`, editServerButton),
      section(`**Description**\n${raidInfo?.description || 'No description provided.'}`, editDescriptionButton),
    )
    .addSeparatorComponents(separator());

if (!isClosing) {
     container
       .addTextDisplayComponents(text(`**Current Status**\n${status}`))
       .addTextDisplayComponents(text(`**Helpers: ${activeHelpers.length}/${helperCapacity}**`));

     if (!activeHelpers.length) {
       container.addTextDisplayComponents(text('No helpers yet.'));
     } else {
       activeHelpers.slice(0, 10).forEach((helper, index) => {
         container.addSectionComponents(section(`<@${helper.helperId}>`, getKickHelperButton(helper, `Helper ${index + 1}`)));
       });
     }

     container
       .addTextDisplayComponents(text('\nYou can type `!waiting`, `!ongoing`, or `!full` to update the raid status. Status will also update automatically for spamming raids.\nUse the buttons below to manage your raid.'))
       .addActionRowComponents(buildMainActionRow());
  } else {
    container
      .addTextDisplayComponents(text('**Status**\nAwaiting Completion'))
      .addTextDisplayComponents(text(`**Helpers: ${activeHelpers.length}/${helperCapacity}**`));

    if (!activeHelpers.length) {
      container.addTextDisplayComponents(text('No helpers yet.'));
    } else {
      activeHelpers.slice(0, 10).forEach((helper, index) => {
        const duration = includeTime ? formatDuration(helper.joinedAt, helper.removedAt || new Date()) : null;
        const body = `<@${helper.helperId}>${duration ? `\n- Time: ${duration}` : ''}`;
        container.addSectionComponents(section(body, getKickHelperButton(helper, `Helper ${index + 1}`)));
      });
    }

    if (removedHelpers.length) {
      container.addTextDisplayComponents(text('**Partial Helpers**'));
      removedHelpers.slice(0, 10).forEach((helper, index) => {
        const duration = includeTime ? formatDuration(helper.joinedAt, helper.removedAt || new Date()) : null;
        const body = `<@${helper.helperId}>${duration ? `\n- Time: ${duration}` : ''}`;
        container.addSectionComponents(section(body, getKickHelperButton(helper, `Helper ${index + 1}`)));
      });
    }

    container.addActionRowComponents(getCloseConfirmRow({ proofImageUrl: raidInfo?.proofImage }));
  }

  return {
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      roles: [RAID_HELPER_ROLE_ID],
      users: raidInfo?.requesterId ? [String(raidInfo.requesterId)] : [],
    },
    components: [container],
  };
}

async function enrichHelpersWithDisplayNames(guild, helpers = []) {
  if (!guild) return helpers;
  return Promise.all(
    helpers.map(async (helper) => {
      if (helper?.displayName) return helper;
      const member = await guild.members?.fetch(helper.helperId).catch(() => null);
      return {
        ...helper,
        displayName: member?.displayName || helper.helperId,
      };
    }),
  );
}

export function buildRaidRequestEmbed(args) {
  return buildRaidRequestEmbeds(args)[0];
}

export async function refreshRaidRequestMessage({ client, channel, raidInfo, helpers = [] }) {
  if (!raidInfo?.messageId) return;
  const targetChannel = channel || await client.channels.fetch(raidInfo.originalChannelId || raidInfo.id).catch(() => null);
  if (!targetChannel) return;
  const message = await targetChannel.messages.fetch(raidInfo.messageId).catch(() => null);
  if (!message) return;
  const requester = await targetChannel.guild?.members?.fetch(raidInfo.requesterId).catch(() => null);
  const displayHelpers = await enrichHelpersWithDisplayNames(targetChannel.guild, helpers);
  await message.edit(buildRaidRequestMessagePayload({ requester, raidInfo, helpers: displayHelpers }));
}
