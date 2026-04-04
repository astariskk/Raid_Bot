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
import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { updateRaid, deleteRaid } from '../../activeRaidState.js';
import { updateLeaderboard } from '../leaderboard/core.js';
import { requireAuth, isStaff } from './ticketUtils.js';

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

function formatTaskArrayForDisplay(tasks) {
  return (tasks || []).map((t) => (TASK_DISPLAY_NAMES?.[t] ?? t)).join(', ');
}

function formatCalculatedBreakdown(calculatedBreakdown) {
  return (calculatedBreakdown || []).map((line) => {
    const m = String(line ?? '').match(/^([a-z0-9_]+)(?:x(\d+))?:\s*(.+)$/i);
    if (!m) return line;
    const key = String(m[1]).toLowerCase();
    const mult = m[2] ? parseInt(m[2], 10) : 1;
    const rest = m[3];
    const display = TASK_DISPLAY_NAMES?.[key] ?? key;
    return `${display}${mult > 1 ? ` x${mult}` : ''}: ${rest}`;
  });
}

function normalizePartialHelpers(raidInfo) {
  const raw = Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [];
  return raw
    .map((e) => ({
      helperId: e?.helperId ? String(e.helperId) : null,
      tasks: Array.isArray(e?.tasks) ? e.tasks.map((t) => String(t).toLowerCase()).filter(Boolean) : [],
    }))
    .filter((e) => e.helperId);
}

function formatPartialHelpersBlock(raidInfo) {
  const partial = normalizePartialHelpers(raidInfo);
  if (!partial.length) return null;

  const lines = partial
    .map((e) => {
      const tasks = e.tasks?.length ? e.tasks.join(', ') : 'No tasks';
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
          const partialHelperIds = normalizePartialHelpers(raidInfo).map((e) => e.helperId);
          const allHelpers = [...new Set([...helperIds, ...partialHelperIds])];

          const helpers = allHelpers.length > 0 ? allHelpers.map((id) => `<@${id}>`).join(', ') : 'None';

          const expEmbed = new EmbedBuilder()
            .setColor(COLOR_EXP_LAIR)
            .setTitle("Raid Completed")
            .setDescription(
              `**Raid requested by:** ${requesterMember ?? `<@${raidInfo.requesterId}>`}\n` +
              `**Helpers:** ${helpers}\n` +
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

          /* ---------- Task EXP Calculation ---------- */
          const {
            calculatedBreakdown,
            originalTotalCalculatedPoints,
            totalCalculatedPoints,
            unknownTasks
          } = calculateTaskPointsWithMultiplier(raidInfo.task);

          /* ---------- Thread Breakdown Message ---------- */
          let breakdown =
            `This thread contains the full details for the raid\n`;

          breakdown += `**Total EXP Calculated:** ${totalCalculatedPoints} EXP ${
            originalTotalCalculatedPoints !== totalCalculatedPoints
              ? ` / ${originalTotalCalculatedPoints} EXP \n The Points were capped.`
              : ""
          }\n\n**Points awarded to Helpers:**\n`;

          const partialHelpers = normalizePartialHelpers(raidInfo);
          const partialMap = new Map(partialHelpers.map((e) => [e.helperId, e.tasks]));

          for (const uid of Object.keys(pointsAwarded)) {
            const member = await guild.members.fetch(uid).catch(() => null);
            const displayName = member?.displayName ?? `<@${uid}>`;
            breakdown += `${displayName}: ${pointsAwarded[uid]} EXP\n`;

            const tasks = partialMap.get(uid) ?? null;
            if (tasks && tasks.length) {
              breakdown += `* Tasks: ${formatTaskArrayForDisplay(tasks)}\n`;
            }
          }

          if (calculatedBreakdown.length) {
            breakdown += "\n**Task EXP Breakdown:**\n";
            breakdown += formatCalculatedBreakdown(calculatedBreakdown).map(t => `* ${t}`).join("\n");

          } else {
            breakdown += "No valid tasks were recognized for EXP calculation.";
          }
          
          if (unknownTasks.length) {
            breakdown +=
              `\n\n⚠️ **Unrecognized Task Entries:**\n` +
              unknownTasks.map(t => `• \`${t}\``).join("\n");
          }

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
      `**Original Task(s):** ${raidInfo.task}`
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
