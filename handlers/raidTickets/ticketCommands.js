import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

import { getRaidInfo, updateRaid, updateRaidStatus } from '../../activeRaidState.js';
import { RAID_STATUS, RAID_HELPER_ROLE_ID } from '../../config/constants.js';
import {
  ADD_HELPER_MODAL_ID,
  buildAddHelperModal,
  getAddHelperUserIds,
} from '../../Embeds/raidTicket/addHelperModal.js';
import { generateRaidMapsEmbed } from '../../utils/raidMaps.js';
import { joinRaidHelper, listRaidHelpers, removeRaidHelper } from '../../utils/raidParticipationStore.js';
import {
  formatCooldownMinutes,
  getHelperPingCooldownRemainingMs,
  getRaidHelperCapacity,
  getRaidStatusForHelpers,
  getRaidTicketMessageUrl,
  getVisibleHelpers,
  isSpammingRaid,
  refreshRaidRequestMessage,
  sendHelperLeftNotification,
} from './raidTicketPresentation.js';
import { recordHelperRoleMention } from './helperRoleMention.js';
import { requireAuth, requireWarrior, hasWarriorRole } from './ticketUtils.js';

async function filterToWarriorHelperIds(interaction, selectedIds, requesterId) {
  const guild = interaction.guild;
  if (!guild) return { filtered: [], rejected: [] };

  const ids = [...new Set((selectedIds || []).map(String))].filter(
    (id) => id && id !== String(interaction.user.id) && id !== String(requesterId ?? ''),
  );

  const filtered = [];
  const rejected = [];
  for (const id of ids) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member?.roles?.cache?.has(RAID_HELPER_ROLE_ID)) {
      rejected.push(id);
      continue;
    }
    filtered.push(id);
  }

  return { filtered, rejected };
}

async function refreshRaidWithHelpers(interaction, raidInfo, helpers) {
  const helperCount = getVisibleHelpers(helpers, raidInfo.requesterId).filter((helper) => !helper.removedAt).length;
  const spamming = isSpammingRaid(raidInfo);
  const nextStatus = spamming
    ? getRaidStatusForHelpers({ isSpamming: true, helperCount, maxHelpers: getRaidHelperCapacity(raidInfo) })
    : raidInfo.status;

  if (spamming && nextStatus !== raidInfo.status) {
    await updateRaidStatus(interaction.client, interaction.channel.id, nextStatus);
  }

  const refreshedRaidInfo = { ...raidInfo, status: nextStatus };
  await refreshRaidRequestMessage({
    client: interaction.client,
    channel: interaction.channel,
    raidInfo: refreshedRaidInfo,
    helpers,
  });
  return refreshedRaidInfo;
}

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
    const embed = generateRaidMapsEmbed(raidInfo, mapMatch[1]);
    await message.channel.send({ embeds: [embed] });
    return;
  }
}

// --- Interaction Handler for Charts/Maps ---
export async function handleCommandInteractions(interaction, raidInfo) {
  if (interaction.customId === 'addHelperButton') {
    if (!await requireAuth(interaction, raidInfo)) return;

    const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    const activeCount = getVisibleHelpers(helpers, raidInfo.requesterId).filter((helper) => !helper.removedAt).length;
    const capacity = getRaidHelperCapacity(raidInfo);
    const slotsLeft = capacity - activeCount;

    if (slotsLeft <= 0) {
      await interaction.reply({
        content: `This raid already has the maximum number of helpers (${capacity}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildAddHelperModal({ maxSelectable: slotsLeft }));
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === ADD_HELPER_MODAL_ID) {
    if (!await requireAuth(interaction, raidInfo)) return;

    const selectedIds = getAddHelperUserIds(interaction);
    if (!selectedIds.length) {
      await interaction.reply({ content: 'Select at least one helper to add.', flags: MessageFlags.Ephemeral });
      return;
    }

    const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    const activeHelpers = getVisibleHelpers(helpers, raidInfo.requesterId).filter((helper) => !helper.removedAt);
    const capacity = getRaidHelperCapacity(raidInfo);
    const slotsLeft = capacity - activeHelpers.length;

    if (slotsLeft <= 0) {
      await interaction.reply({
        content: `This raid already has the maximum number of helpers (${capacity}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const alreadyActive = new Set(activeHelpers.map((helper) => String(helper.helperId)));
    const candidates = selectedIds.filter((id) => !alreadyActive.has(String(id)));
    if (!candidates.length) {
      await interaction.reply({ content: 'Everyone you selected is already on the helper list.', flags: MessageFlags.Ephemeral });
      return;
    }

    const { filtered: warriorIds, rejected } = await filterToWarriorHelperIds(
      interaction,
      candidates.slice(0, slotsLeft),
      raidInfo.requesterId,
    );
    if (!warriorIds.length) {
      await interaction.reply({
        content: rejected.length
          ? `None of the selected users have the <@&${RAID_HELPER_ROLE_ID}> role.`
          : 'No valid helpers to add.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    for (const helperId of warriorIds) {
      await joinRaidHelper(interaction.channel.id, helperId);
    }

    const updatedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    await refreshRaidWithHelpers(interaction, raidInfo, updatedHelpers);

    const addedMentions = warriorIds.map((id) => `<@${id}>`).join(', ');
    let reply = `Added ${warriorIds.length} helper(s): ${addedMentions}.`;
    if (rejected.length) {
      reply += ` Skipped ${rejected.length} without the warrior role.`;
    }
    if (candidates.length > warriorIds.length) {
      reply += ` Only ${slotsLeft} slot(s) were available.`;
    }

    await interaction.reply({ content: reply, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'joinRaidTicket') {
    const isRequester = interaction.user.id === raidInfo.requesterId;

    if (!isRequester && !hasWarriorRole(interaction.member)) {
      await interaction.reply({ content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to join this ticket.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (isRequester) {
      if (raidInfo.mapNumber) {
        const embed = generateRaidMapsEmbed(raidInfo, raidInfo.mapNumber);
        // Always send the embed; generateRaidMapsEmbed handles missing map links safely.
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else {
        // Avoid calling generateRaidMapsEmbed with an empty map number (would produce invalid links).
        await interaction.reply({ content: 'No map number is set yet.', flags: MessageFlags.Ephemeral });
      }
      return;
    }


    const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    const alreadyJoined = helpers.some((helper) => helper.helperId === interaction.user.id && !helper.removedAt);
    if (alreadyJoined) {
      await interaction.reply({ content: 'You are already in the ticket.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Reply first to avoid interaction timeout, then do async operations
    const replyContent = raidInfo.mapNumber
      ? { content: 'You joined this raid ticket.', embeds: [generateRaidMapsEmbed(raidInfo, raidInfo.mapNumber)], flags: MessageFlags.Ephemeral }
      : { content: 'You joined this raid ticket. No map number is set yet.', flags: MessageFlags.Ephemeral };

    // Fire off reply immediately
    const replyTask = interaction.reply(replyContent).catch(() => {});

    // Then do async operations
    await joinRaidHelper(interaction.channel.id, interaction.user.id);
    const updatedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    const activeHelperCount = getVisibleHelpers(updatedHelpers, raidInfo.requesterId).filter((h) => !h.removedAt).length;
    const helperCapacity = Math.max(1, getRaidHelperCapacity(raidInfo));

    const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'A helper';

    const spamming = isSpammingRaid(raidInfo);
    const nextStatus = spamming
      ? getRaidStatusForHelpers({ isSpamming: true, helperCount: activeHelperCount, maxHelpers: helperCapacity })
      : raidInfo.status;

    if (spamming && nextStatus !== raidInfo.status) {
      await updateRaidStatus(interaction.client, interaction.channel.id, nextStatus);
    }

    await refreshRaidRequestMessage({ client: interaction.client, channel: interaction.channel, raidInfo: { ...raidInfo, status: nextStatus }, helpers: updatedHelpers });

    const requestMessageUrl = interaction.guildId && raidInfo.messageId
      ? `https://discord.com/channels/${interaction.guildId}/${interaction.channel.id}/${raidInfo.messageId}`
      : null;
    if (requestMessageUrl) {
      const components = [
        new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${displayName} has joined this raid ticket. Status is ${activeHelperCount}/${helperCapacity}: [**View Raid Ticket**](${requestMessageUrl})`)),
      ];
      await interaction.channel.send({
        flags: MessageFlags.IsComponentsV2,
        components,
      }).catch(() => {});
    }

    await replyTask;
    return;
  }

  if (interaction.customId?.startsWith('kickRaidHelper_')) {
    const helperId = interaction.customId.slice('kickRaidHelper_'.length);
    if (!helperId) {
      await interaction.reply({ content: 'Could not identify that helper.', flags: MessageFlags.Ephemeral });
      return;
    }

    const isSelfKick = interaction.user.id === helperId;
    if (isSelfKick) {
      if (!await requireWarrior(interaction)) return;
    } else if (!await requireAuth(interaction, raidInfo)) {
      return;
    }

    // Reply first to avoid interaction timeout
    const replyContent = isSelfKick ? 'You left this raid ticket.' : `Removed <@${helperId}> from this raid ticket.`;
    await interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });

    // Then do async operations
    await removeRaidHelper(interaction.channel.id, helperId, interaction.user.id);

    const partialHelpers = (Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [])
      .filter((entry) => String(entry?.helperId) !== String(helperId));
    if (partialHelpers.length !== (raidInfo?.partialHelpers?.length ?? 0)) {
      await updateRaid(interaction.channel.id, { partialHelpers });
    }

    const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true });
    const activeHelperCount = getVisibleHelpers(helpers, raidInfo.requesterId).filter((h) => !h.removedAt).length;
    const helperCapacity = Math.max(1, getRaidHelperCapacity(raidInfo));

    const spamming = isSpammingRaid(raidInfo);
    const nextStatus = spamming
      ? getRaidStatusForHelpers({ isSpamming: true, helperCount: activeHelperCount, maxHelpers: helperCapacity })
      : RAID_STATUS.WAITING;

    if (spamming && nextStatus !== raidInfo.status) {
      await updateRaidStatus(interaction.client, interaction.channel.id, nextStatus);
    }

    await refreshRaidRequestMessage({ client: interaction.client, channel: interaction.channel, raidInfo: { ...raidInfo, status: nextStatus }, helpers });

    await sendHelperLeftNotification({
      channel: interaction.channel,
      guildId: interaction.guildId,
      raidInfo: raidInfo,
      helperId,
      activeHelperCount,
    }).catch(() => {});
    return;
  }

  if (interaction.customId === 'pingHelpersButton') {
    if (!await requireAuth(interaction, raidInfo)) return;

    const remainingMs = getHelperPingCooldownRemainingMs(raidInfo);
    if (remainingMs > 0) {
      await interaction.reply({
        content: `You can ping <@&${RAID_HELPER_ROLE_ID}> again in ${formatCooldownMinutes(remainingMs)} minute(s).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketUrl = getRaidTicketMessageUrl(interaction.guildId, interaction.channel.id, raidInfo.messageId);

    const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
    const activeHelperCount = getVisibleHelpers(helpers, raidInfo.requesterId).filter((h) => !h.removedAt).length;
    const helperCapacity = Math.max(1, getRaidHelperCapacity(raidInfo));

    const components = [
      new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${RAID_HELPER_ROLE_ID}> Reminder from the raid requester: Still needs help with the raid. Status is ${activeHelperCount}/${helperCapacity}: [**View Raid Ticket**](${ticketUrl})`)),
    ];

    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components,
      allowedMentions: { roles: [RAID_HELPER_ROLE_ID] },
    });

    const mentionedAt = await recordHelperRoleMention(interaction.channel.id);
    raidInfo.lastHelperRoleMentionAt = mentionedAt;
    raidInfo.lastHelperPingAt = mentionedAt;
    return;
  }

  if (interaction.customId === 'raidmapsButton') {
    const isRequester = interaction.user.id === raidInfo.requesterId;
    const helpers = await listRaidHelpers(interaction.channel.id).catch(() => []);
    const joined = helpers.some((helper) => helper.helperId === interaction.user.id);
    if (!isRequester) {
      if (!joined) {
        await interaction.reply({ content: 'Join this ticket first to view maps.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!await requireWarrior(interaction)) return;
    }
    if (!raidInfo.mapNumber) {
      await interaction.reply({ content: 'No map number set. Use Edit Server to add one.', flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = generateRaidMapsEmbed(raidInfo, raidInfo.mapNumber);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
}
