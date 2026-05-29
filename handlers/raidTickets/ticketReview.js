import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionsBitField,
  MessageFlags
} from 'discord.js';

import {
  EXP_LAIR_CHANNEL_ID,
  EMBED_COLOR,
  BLUE_EMBED_COLOR,
  MODERATOR_ROLE_ID,
  OFFICER_ROLE_ID,
  RAID_MANAGER_ROLE_ID,
  RAID_HELPER_ROLE_ID,
  RAID_STATUS,
  TASK_DISPLAY_NAMES,
} from '../../config/constants.js';
import { updateRaid, deleteRaid } from '../../activeRaidState.js';
import { updateLeaderboard } from '../leaderboard/core.js';
import { buildExpLairThreadBreakdown } from './domain/closePoints.js';
import { normalizePartialHelpers } from './domain/partialHelpers.js';
import { listRaidHelpers } from '../../utils/raidParticipationStore.js';
import { requireAuth, isStaff } from './ticketUtils.js';
import { getRaidTaskFieldDisplay, getTaskKeys, isSpammingRaid } from './raidTicketPresentation.js';

const COLOR_INFO = EMBED_COLOR;
const COLOR_EXP_LAIR = BLUE_EMBED_COLOR;

function formatTaskTokenForDisplay(tokenRaw) {
  const token = String(tokenRaw ?? '').trim();
  if (!token) return '';

  const m = token.match(/^(.+?)(?:\s*x\s*(\d+))?$/i);
  const rawName = (m?.[1] ?? token).trim().toLowerCase();
  const multiplier = m?.[2] ? parseInt(m[2], 10) : 1;

  const display = TASK_DISPLAY_NAMES?.[rawName] ?? rawName;
  if (multiplier && multiplier > 1) return `${display} x${multiplier}`;
  return display;
}

function formatTaskStringForDisplay(taskString) {
  const raw = String(taskString ?? '').trim();
  if (!raw) return '';
  return raw
    .split(/[+,]/)
    .map((t) => formatTaskTokenForDisplay(t))
    .filter(Boolean)
    .join(', ');
}

function formatPartialHelpersBlock(raidInfo) {
  const partial = normalizePartialHelpers(raidInfo);
  if (!partial.length) return null;

  const lines = partial
    .map((e) => {
      const tasks = e.tasks?.length ? e.tasks.join(', ') : 'No task helped';
      // Avoid pinging partial helpers in the admin review embed.
      return `- \`${e.helperId}\`: ${tasks}`;
    })
    .join('\n')
    .slice(0, 1000);

  return `**Partial Helpers:**\n${lines}`;
}

export async function finalizeAdminReview(
  client, channel,
  raidInfo,
  pointsAwarded = {},
  initiatorId,
  reason = "completed",
  notes = ""
) {
  try {
    const guild = channel.guild;
    const everyoneRole = guild.roles.everyone;

    const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
    const officerRole = guild.roles.cache.get(OFFICER_ROLE_ID);
    const raidManagerRole = guild.roles.cache.get(RAID_MANAGER_ROLE_ID);

    const requesterMember = await guild.members
      .fetch(raidInfo.requesterId)
      .catch(() => null);

    /* -------------------- CLOSE WARNING -------------------- */
    await channel.send("This raid will now close.").catch(() => {});
    await new Promise(r => setTimeout(r, 5000));

    /* -------------------- LOCK CHANNEL -------------------- */

    await channel.permissionOverwrites.edit(everyoneRole, {
      ViewChannel: false
    }).catch(() => {});

    await channel.permissionOverwrites.edit(RAID_HELPER_ROLE_ID, {
      ViewChannel: false
    }).catch(() => {});

    if (
      requesterMember && !isStaff(requesterMember))
     {
      await channel.permissionOverwrites.edit(requesterMember, {
        ViewChannel: false
      }).catch(() => {});
    }

    if (moderatorRole) {
      await channel.permissionOverwrites.edit(moderatorRole, { ViewChannel: true }).catch(() => {});
    }
    if (officerRole) {
      await channel.permissionOverwrites.edit(officerRole, { ViewChannel: true }).catch(() => {});
    }
    if (raidManagerRole) {
      await channel.permissionOverwrites.edit(raidManagerRole, { ViewChannel: true }).catch(() => {});
    }

    await channel.setName("Pending-raid-review").catch(() => {});

    /* -------------------- EXP LAIR POST -------------------- */
          let expLairMessageLink = "N/A (no post)";

    if (reason === "completed") {
      try {
        const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);

        if (expLairChannel?.type === ChannelType.GuildText) {
          const helperIds = Object.keys(pointsAwarded);
          const partialHelpers = normalizePartialHelpers(raidInfo);
          // EXP-lair embed should mention users; the thread breakdown uses display names only.
          const helperMentions = helperIds.length
            ? helperIds.map((id) => `<@${id}>`).join(', ')
            : 'None';

          const expEmbed = new EmbedBuilder()
            .setColor(COLOR_EXP_LAIR)
            .setTitle("Raid Completed")
            .setDescription(
              `**Raid requested by:** ${requesterMember ?? `<@${raidInfo.requesterId}>`}\n` +
              `**Helpers:** ${helperMentions}\n` +
              `**Task(s):** ${formatTaskStringForDisplay(raidInfo.task)}\n` +
              `**Description:** ${raidInfo.description || "No description provided."}`
            )
            .setTimestamp()
            .setFooter({ text: "Raid Completion Details" });

          const files = [];

          if (raidInfo.proofImage) {
            try {
              const res = await fetch(raidInfo.proofImage);
              const buffer = Buffer.from(await res.arrayBuffer());
              files.push({ attachment: buffer, name: "proof.png" });
              expEmbed.setImage("attachment://proof.png");
            } catch (err) {
              console.error("Failed to fetch proof image:", err);
            }
          }

          const sent = await expLairChannel.send({
            content: `Raid completed for ${requesterMember?.displayName ?? `<@${raidInfo.requesterId}>`}.`,
            embeds: [expEmbed],
            files
          });

          expLairMessageLink = sent.url;

          /* ---------- Thread ---------- */
          const thread = await sent.startThread({
            name: `Raid for ${requesterMember?.displayName ?? raidInfo.requesterId}`,
            autoArchiveDuration: 60
          });

          const joinedHelpers = await listRaidHelpers(channel.id, { includeRemoved: true }).catch(() => []);
          const joinedById = new Map(joinedHelpers.map((helper) => [helper.helperId, helper]));
          const breakdown = await buildExpLairThreadBreakdown(guild, raidInfo, pointsAwarded, {
            partialHelpers,
            spamming: isSpammingRaid(raidInfo),
            joinedById,
          });

          await thread.send(breakdown);
        }
      } catch (err) {
        console.error("EXP Lair post failed:", err);
      }
    }


    /* -------------------- ADMIN REVIEW EMBED -------------------- */
    const desc = [
      `This raid was **${reason}** by <@${initiatorId}>.`,
      `**Requester:** <@${raidInfo.requesterId}>`,
      `**Original Task${getTaskKeys(raidInfo.task).length === 1 ? '' : 's'}:** ${getRaidTaskFieldDisplay(raidInfo.task)}`
    ];

    if (notes) desc.push(`**Notes:** ${notes}`);
    if (reason === "completed") {
      desc.push(`**EXP Lair Post:** ${expLairMessageLink}`);
    }

    const reviewEmbed = new EmbedBuilder()
      .setTitle(`Raid ${reason === "cancelled" ? "Cancelled" : "Completed"} - Admin Review`)
      .setColor(COLOR_INFO)
      .setDescription(desc.join("\n"))
      .setTimestamp()
      .setFooter({ text: "Staff may delete this channel after review." });

    const deleteBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("deleteFinalizedRaidChannel")
        .setLabel("Delete Channel After Review")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [reviewEmbed], components: [deleteBtn] });

    /* -------------------- DB + LEADERBOARD -------------------- */
    await updateRaid(channel.id, {
      status: RAID_STATUS.ADMIN_REVIEW,
      isAwaitingCompletion: false,
      awaitingCompletionRequesterId: null,
      pointsAwarded,
      expLairMessageLink: reason === "completed" ? expLairMessageLink : null
    });

    if (reason === "completed") {
      for (const uid of Object.keys(pointsAwarded)) {
        await updateLeaderboard(uid, pointsAwarded[uid]);
      }
    }

  } catch (err) {
    console.error("finalizeAdminReview failed:", err);
    await channel.send("An error occurred. Please contact staff.");
  }
}

/* -------------------- DELETE BUTTON HANDLER -------------------- */
export async function handleReviewInteractions(interaction, raidInfo) {
  if (interaction.customId !== "deleteFinalizedRaidChannel") return;
  if (!await requireAuth(interaction, raidInfo, "staff")) return;

  await interaction.reply({ content: "Deleting channel…", flags: MessageFlags.Ephemeral });
  await deleteRaid(interaction.channel.id);
  await interaction.channel.delete().catch(() => {});
}
