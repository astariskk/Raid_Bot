import { MessageFlags } from 'discord.js';

import { updateRaidStatus } from '../../activeRaidState.js';
import { RAID_STATUS, RAID_HELPER_ROLE_ID } from '../../config/constants.js';
import { generateRaidMapsEmbed, parseRaidTasks } from '../../utils/raidMaps.js';
import { joinRaidHelper, listRaidHelpers, removeRaidHelper } from '../../utils/raidParticipationStore.js';
import { getRaidStatusForHelpers, isSpammingRaid, refreshRaidRequestMessage } from './raidTicketPresentation.js';
import { requireAuth } from './ticketUtils.js';

// --- Main Message Handler ---
export async function handleTicketMessages(message, client, raidInfo) {
  const content = String(message.content ?? '').toLowerCase().trim();

  if (!raidInfo) return;

  // 1. Status Updates
  const statusMap = {
    '!waiting': RAID_STATUS.WAITING,
    '!full': RAID_STATUS.FULL,
    '!ongoing': RAID_STATUS.ONGOING,
  };
  if (statusMap[content]) {
    if ([RAID_STATUS.AWAITING_COMPLETION, RAID_STATUS.COMPLETED].includes(raidInfo.status)) return;
    try {
      await updateRaidStatus(client, message.channel.id, statusMap[content]);
      await message.react('👍');
    } catch (e) {
      console.error(e);
    }
    return;
  }

  // 2. Map Commands
  const mapMatch = content.match(/^!raidmaps\s+(\d+)$/);
  if (mapMatch) {
    const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), mapMatch[1]);
    await message.channel.send({ embeds: [embed] });
    return;
  }
}

// --- Interaction Handler for Charts/Maps ---
export async function handleCommandInteractions(interaction, raidInfo) {
  if (interaction.customId === 'joinRaidTicket') {
    if (!interaction.member?.roles?.cache?.has(RAID_HELPER_ROLE_ID) && interaction.user.id !== raidInfo.requesterId) {
      await interaction.reply({ content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to join this ticket.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.user.id === raidInfo.requesterId) {
      if (raidInfo.mapNumber) {
        const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), raidInfo.mapNumber);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'No map number is set yet.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    await joinRaidHelper(interaction.channel.id, interaction.user.id);
    const helpers = await listRaidHelpers(interaction.channel.id);
    const helperCount = helpers.filter((helper) => helper.helperId !== raidInfo.requesterId).length;
    const spamming = isSpammingRaid(raidInfo);
    const nextStatus = spamming
      ? getRaidStatusForHelpers({ isSpamming: true, helperCount })
      : raidInfo.status;

    if (spamming && nextStatus !== raidInfo.status) {
      await updateRaidStatus(interaction.client, interaction.channel.id, nextStatus);
    }

    await refreshRaidRequestMessage({
      client: interaction.client,
      channel: interaction.channel,
      raidInfo: { ...raidInfo, status: nextStatus },
      helpers,
    });

    const requestMessageUrl = interaction.guildId && raidInfo.messageId
      ? `https://discord.com/channels/${interaction.guildId}/${interaction.channel.id}/${raidInfo.messageId}`
      : null;
    await interaction.channel.send({
      content: requestMessageUrl
        ? `${interaction.user} joined this raid ticket: ${requestMessageUrl}`
        : `${interaction.user} joined this raid ticket.`,
      allowedMentions: { users: [interaction.user.id] },
    }).catch(() => {});

    if (raidInfo.mapNumber) {
      const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), raidInfo.mapNumber);
      await interaction.reply({ content: 'You joined this raid ticket.', embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'You joined this raid ticket. No map number is set yet.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.customId?.startsWith('kickRaidHelper_')) {
    if (!await requireAuth(interaction, raidInfo)) return;

    const helperId = interaction.customId.slice('kickRaidHelper_'.length);
    if (!helperId) {
      await interaction.reply({ content: 'Could not identify that helper.', flags: MessageFlags.Ephemeral });
      return;
    }

    await removeRaidHelper(interaction.channel.id, helperId, interaction.user.id);
    const helpers = await listRaidHelpers(interaction.channel.id);
    const helperCount = helpers.filter((helper) => helper.helperId !== raidInfo.requesterId).length;
    const spamming = isSpammingRaid(raidInfo);
    const nextStatus = spamming
      ? getRaidStatusForHelpers({ isSpamming: true, helperCount })
      : raidInfo.status;

    if (spamming && nextStatus !== raidInfo.status) {
      await updateRaidStatus(interaction.client, interaction.channel.id, nextStatus);
    }

    await refreshRaidRequestMessage({
      client: interaction.client,
      channel: interaction.channel,
      raidInfo: { ...raidInfo, status: nextStatus },
      helpers,
    });

    await interaction.reply({ content: `Removed <@${helperId}> from this raid ticket.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'raidmapsButton') {
    const helpers = await listRaidHelpers(interaction.channel.id).catch(() => []);
    const joined = helpers.some((helper) => helper.helperId === interaction.user.id);
    if (!joined && interaction.user.id !== raidInfo.requesterId) {
      await interaction.reply({ content: 'Join this ticket first to view maps.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!raidInfo.mapNumber) {
      await interaction.reply({ content: 'No map number set. Use Edit Server to add one.', flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), raidInfo.mapNumber);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
}
