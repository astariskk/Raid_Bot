// handlers/sharedState.js
import { EmbedBuilder } from 'discord.js';

/**
 * Shared state for active raid threads.
 * Maps thread ID to an object containing raid details.
 * {
 * messageId: 'original_embed_message_id',
 * originalChannelId: 'channel_id_of_the_embed',
 * task: 'weekly',
 * requesterId: 'user_id',
 * awaitingCompletion: true/false,
 * ...otherDetails
 * }
 */
export const activeRaidThreads = {};

/**
 * Updates the status on the original raid request embed.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} threadId The ID of the thread where the status update was triggered.
 * @param {string} newStatus The new status string (e.g., 'Ongoing', 'Full', 'Done ✅').
 * @param {number} newColor The new color for the embed.
 */
export async function updateRaidStatus(client, threadId, newStatus, newColor) {
    const raidInfo = activeRaidThreads[threadId];
    if (!raidInfo || !raidInfo.messageId || !raidInfo.originalChannelId) {
        console.log(`Could not find raid info or messageId for thread ${threadId} to update status.`);
        return;
    }

    try {
        const channel = await client.channels.fetch(raidInfo.originalChannelId);
        const message = await channel.messages.fetch(raidInfo.messageId);
        const originalEmbed = message.embeds[0];

        if (!originalEmbed) {
            console.error(`Original embed not found for message ${raidInfo.messageId}`);
            return;
        }

        const updatedEmbed = new EmbedBuilder(originalEmbed.data)
            .setFields(
                ...originalEmbed.fields.map(field => {
                    if (field.name === 'Status') {
                        return { name: 'Status', value: newStatus, inline: true };
                    }
                    return field;
                })
            )
            .setColor(newColor)
            .setTimestamp(); // Update the timestamp to show the last status change

        await message.edit({ embeds: [updatedEmbed] });
        console.log(`Updated status to "${newStatus}" for raid in thread ${threadId}`);

    } catch (error) {
        console.error(`Failed to update raid status for thread ${threadId}:`, error);
    }
}
