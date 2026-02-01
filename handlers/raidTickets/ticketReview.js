import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionsBitField
} from 'discord.js';

import {
  EXP_LAIR_CHANNEL_ID,
  MODERATOR_ROLE_ID,
  OFFICER_ROLE_ID,
  RAID_MANAGER_ROLE_ID,
  RAID_HELPER_ROLE_ID
} from '../../config/constants.js';
import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { updateRaid, deleteRaid } from '../../activeRaidState.js';
import { updateLeaderboard } from '../leaderboardCore.js';
import { requireAuth, isStaff } from './ticketUtils.js';

const COLOR_INFO = 0x0099ff;

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
            const helpers =
            Object.keys(pointsAwarded).length > 0
              ? Object.keys(pointsAwarded).map(id => `<@${id}>`).join(", ")
              : "None";

          const expEmbed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle("Raid Completed")
            .setDescription(
              `**Raid requested by:** ${requesterMember ?? `<@${raidInfo.requesterId}>`}\n` +
              `**Helpers:** ${helpers}\n` +
              `**Task(s):** ${raidInfo.task}\n` +
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
          
          for (const uid of Object.keys(pointsAwarded)) {
            const member = await guild.members.fetch(uid).catch(() => null);
            breakdown += `* ${member?.displayName ?? `<@${uid}>`}: ${pointsAwarded[uid]} EXP\n`; 
          }           

          if (calculatedBreakdown.length) {
            breakdown += "\n**Task EXP Breakdown:**\n";
            breakdown += calculatedBreakdown.map(t => `* ${t}`).join("\n");

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
      status: "admin_review",
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

  await interaction.reply({ content: "Deleting channel…", ephemeral: true });
  await deleteRaid(interaction.channel.id);
  await interaction.channel.delete().catch(() => {});
}
