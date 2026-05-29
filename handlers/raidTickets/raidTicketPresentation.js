import { EmbedBuilder } from 'discord.js';
import {
  EMBED_COLOR,
  RAID_STATUS,
  STATUS_COLORS,
} from '../../config/constants.js';
import { HELPER_PING_COOLDOWN_MS } from '../../Embeds/raidTicket/constants.js';
import {
  buildRaidRequestMessagePayload,
  sendHelperLeftNotification as sendHelperLeftNotificationEmbed,
} from '../../Embeds/raidTicket/index.js';
import {
  getRaidHelperCapacity,
  getRaidTaskFieldDisplay,
  getVisibleHelpers,
  isSpammingRaid,
} from './raidTicketLogic.js';

export { HELPER_PING_COOLDOWN_MS } from '../../Embeds/raidTicket/constants.js';

export {
  buildClosePointsMap,
  buildExpLairThreadBreakdown,
  formatActiveHelperEmbedLines,
  formatPartialHelperEmbedLines,
  getAttachableTaskKeys,
  getPartialHelpersNeedingTaskAttach,
  mergePartialHelperAttachments,
  normalizePartialHelpers,
  raidHasNonSpammingTasks,
} from './domain/index.js';

export {
  SPAMMING_TASK_KEY,
  SPAMMING_RATE_PER_MINUTE,
  SPAMMING_EXP_CAP,
  getTaskKeys,
  getTaskDisplayNames,
  getRaidTaskFieldDisplay,
  parseMapNameList,
  getJoinPrefixesForRaid,
  isSpammingRaid,
  getNormalTaskString,
  computeRaidStatusFromHelpers,
  getRaidStatusForHelpers,
  getRaidPartySize,
  getRaidHelperCapacity,
  getVisibleHelpers,
} from './raidTicketLogic.js';

export {
  buildMentionMessage,
  buildHelpMessage,
  buildRaidRequestMessagePayload,
  buildMainTicketMessagePayload,
  sendRaidTicketMessages,
  getRaidTicketMessageUrl,
} from '../../Embeds/raidTicket/index.js';

export { getHelperRoleMentionCooldownRemainingMs as getHelperPingCooldownRemainingMs } from './helperRoleMention.js';

function getRequesterDisplay(requester) {
  return requester?.displayName || requester?.user?.globalName || requester?.user?.username || requester?.tag || requester?.id || 'Requester';
}

function getRequesterAvatar(requester) {
  return requester?.displayAvatarURL?.() || requester?.user?.displayAvatarURL?.() || null;
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

function formatPartialHelperMentions(helpers = []) {
  if (!helpers.length) return '*None yet*';
  return helpers.map((helper) => `* <@${helper.helperId}>`).join('\n');
}

export function buildRaidRequestEmbeds({ requester, raidInfo, helpers = [] }) {
  const taskFieldValue = getRaidTaskFieldDisplay(raidInfo?.task);
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  const activeHelpers = visibleHelpers.filter((helper) => !helper.removedAt);
  const midRunPartials = visibleHelpers.filter((helper) => helper.removedAt);
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
      { name: 'Task', value: taskFieldValue, inline: false },
      { name: 'Server', value: raidInfo?.server || 'None', inline: false },
      { name: 'Description', value: raidInfo?.description || 'No description provided.', inline: false },
    );

  const statusEmbed = new EmbedBuilder().setColor(color);

  if (!isClosing) {
    statusEmbed
      .addFields(
        { name: 'Current Status', value: status, inline: false },
        { name: `Helpers: ${activeHelpers.length}/${helperCapacity}`, value: formatHelperLines(activeHelpers), inline: false },
      );
    if (midRunPartials.length) {
      statusEmbed.addFields({
        name: 'Partial Helpers',
        value: formatPartialHelperMentions(midRunPartials),
        inline: false,
      });
    }
    return [detailsEmbed, statusEmbed];
  }

  statusEmbed.addFields(
    { name: 'Status', value: 'Awaiting Completion', inline: false },
    { name: `Helpers: ${activeHelpers.length}/${helperCapacity}`, value: formatHelperLines(activeHelpers, { includeTime }), inline: false },
  );

  if (midRunPartials.length) {
    statusEmbed.addFields({
      name: 'Partial Helpers',
      value: formatPartialHelperMentions(midRunPartials),
      inline: false,
    });
  }

  return [detailsEmbed, statusEmbed];
}

export function formatCooldownMinutes(remainingMs) {
  return Math.max(1, Math.ceil(remainingMs / 60000));
}

export async function sendHelperLeftNotification({
  channel,
  guildId,
  raidInfo,
  helperId,
  activeHelperCount,
}) {
  if (!channel || !raidInfo?.messageId) return;

  const guild = channel.guild;
  const member = guild ? await guild.members.fetch(helperId).catch(() => null) : null;
  const displayName = member?.displayName || member?.user?.globalName || member?.user?.username || 'A helper';

  const count = activeHelperCount ?? (await listRaidHelpers(channel.id, { includeRemoved: true }).catch(() => [])).filter((h) => !h.removedAt).length;

  await sendHelperLeftNotificationEmbed({
    channel,
    guildId,
    raidInfo,
    helperDisplayName: displayName,
    activeHelperCount: count,
  });
}

export function buildRaidRequestEmbed(args) {
  return buildRaidRequestEmbeds(args)[0];
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

export async function refreshRaidRequestMessage({ client, channel, raidInfo, helpers = [] }) {
  if (!raidInfo?.messageId) return;
  const targetChannel = channel || await client.channels.fetch(raidInfo.originalChannelId || raidInfo.id).catch(() => null);
  if (!targetChannel) return;
  const message = await targetChannel.messages.fetch(raidInfo.messageId).catch(() => null);
  if (!message) return;
  const requester = await targetChannel.guild?.members?.fetch(raidInfo.requesterId).catch(() => null);
  const displayHelpers = await enrichHelpersWithDisplayNames(targetChannel.guild, helpers);
  const ticketHelpers = getVisibleHelpers(displayHelpers, raidInfo?.requesterId);
  const isClosing = Boolean(raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION);
  await message.edit(buildRaidRequestMessagePayload({
    requester,
    raidInfo,
    helpers: ticketHelpers,
    isClosing,
  }));
}
