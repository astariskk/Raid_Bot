import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, RAID_STATUS, STATUS_COLORS, TASK_DISPLAY_NAMES } from '../../config/constants.js';
import { buildRaidRequestComponents } from './buttons/threadButtons.js';

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

export function getRaidStatusForHelpers({ isSpamming, helperCount }) {
  if (!isSpamming) return RAID_STATUS.WAITING;
  if (helperCount >= 4) return RAID_STATUS.FULL;
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

export function buildRaidRequestEmbeds({ requester, raidInfo, helpers = [] }) {
  const displayTasks = getTaskDisplayNames(raidInfo?.task);
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  const storedStatus = raidInfo?.status || RAID_STATUS.WAITING;
  const status = storedStatus;
  const color = STATUS_COLORS?.[status] ?? EMBED_COLOR;
  const displayName = getRequesterDisplay(requester);
  const avatar = getRequesterAvatar(requester);

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

  const helperLines = visibleHelpers.length
    ? visibleHelpers.map((helper, index) => `Helper ${index + 1}: <@${helper.helperId}>`).join('\n')
    : 'No helpers yet.';

  const statusEmbed = new EmbedBuilder()
    .setColor(color)
    .addFields(
      { name: 'Status', value: status, inline: false },
      { name: `Helpers: ${visibleHelpers.length}/4`, value: helperLines, inline: false },
    );

  return [detailsEmbed, statusEmbed];
}

export function buildRaidRequestMessagePayload({ requester, raidInfo, helpers = [] }) {
  const visibleHelpers = getVisibleHelpers(helpers, raidInfo?.requesterId);
  return {
    embeds: buildRaidRequestEmbeds({ requester, raidInfo, helpers: visibleHelpers }),
    components: buildRaidRequestComponents(visibleHelpers),
  };
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
  await message.edit(buildRaidRequestMessagePayload({ requester, raidInfo, helpers }));
}
