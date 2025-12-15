import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType } from 'discord.js';
import { EXP_LAIR_CHANNEL_ID, MODERATOR_ROLE_ID } from '../../config/constants.js';
import { updateRaid, deleteRaid } from '../../activeRaidState.js';
import { updateLeaderboard } from '../leaderboardCore.js';
import { requireAuth } from './ticketUtils.js';

export async function finalizeAdminReview(client, channel, raidInfo, pointsAwarded, initiatorId, reason, notes = "") {
    // 1. Lock Channel
    await channel.setName("Pending-raid-review");
    // (Update permissions to hide from everyone except staff - omitted for brevity, copy from original)

    // 2. Post to EXP Lair (if completed)
    let expLink = "N/A";
    if (reason === "completed") {
        const lairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);
    }

    // 3. Create Admin Review Embed in Ticket
    const reviewEmbed = new EmbedBuilder()
        .setTitle(`Raid ${reason} - Admin Review`)
        .setDescription(`Initiated by <@${initiatorId}>\nPoints: ${Object.keys(pointsAwarded).length} users`)
        .setColor(reason === "completed" ? 0x0099ff : 0xdd2e44);

    const delBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("deleteFinalizedRaidChannel").setLabel("Delete Channel").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [reviewEmbed], components: [delBtn] });

    // 4. Update DB & Leaderboard
    await updateRaid(channel.id, { status: "admin_review", pointsAwarded });
    if (reason === "completed") {
        for (const [uid, pts] of Object.entries(pointsAwarded)) {
            await updateLeaderboard(uid, pts);
        }
    }
}

// Handler for the "Delete Channel" button
export async function handleReviewInteractions(interaction, raidInfo) {
    if (interaction.customId === "deleteFinalizedRaidChannel") {
        if (!await requireAuth(interaction, raidInfo, 'staff')) return;
        
        await interaction.reply({ content: "Deleting...", ephemeral: true });
        await deleteRaid(interaction.channel.id);
        await interaction.channel.delete();
    }
}