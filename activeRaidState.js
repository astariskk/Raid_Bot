// activeRaidState.js
import { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { ALLOWED_TASK_NAMES } from './config/constants.js'; // Needed for validation in getEditTaskModal
import { getTasksEmbed } from './handlers/raidLogsHandler.js'; // Needed for validation in getEditTaskModal


/**
 * Shared state for active raid threads.
 * Maps thread ID to an object containing raid details.
 * {
 * messageId: 'original_embed_message_id',
 * originalChannelId: 'channel_id_of_the_embed',
 * task: 'weekly', // This will now accumulate all tasks (e.g., 'weekly + speaker + speaker x2')
 * requesterId: 'user_id',
 * awaitingCompletion: true/false,
 * mapName: 'map_name',
 * server: 'server_name',
 * description: 'raid_description',
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
                originalEmbed.fields.map(field => {
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

/**
 * Creates and returns the Modal for editing raid tasks.
 * @param {string} [currentTasks=''] - The current tasks to pre-fill the input field.
 * @returns {ModalBuilder} The modal for editing tasks.
 */
export function getEditTaskModal(currentTasks = '') {
    const modal = new ModalBuilder()
        .setCustomId('editTaskModal')
        .setTitle('Edit Raid Task(s)');

    const taskInput = new TextInputBuilder()
        .setCustomId('editedTaskInput')
        .setLabel("Current Task(s): ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(`Enter task(s) like 'speaker' or 'dage + darkon'`)
        .setValue(currentTasks); // Pre-fill with current tasks

    const firstActionRow = new ActionRowBuilder().addComponents(taskInput);
    modal.addComponents(firstActionRow);
    return modal;
}

/**
 * Updates properties of the original raid log embed message.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} threadId The ID of the thread associated with the raid.
 * @param {object} updates An object containing properties to update (e.g., { title: 'New Title', fields: [{ name: 'Task(s)', value: 'new task' }] }).
 */
export async function updateRaidLogEmbed(client, threadId, updates) {
    const raidInfo = activeRaidThreads[threadId];
    if (!raidInfo || !raidInfo.messageId || !raidInfo.originalChannelId) {
        console.log(`Could not find raid info or messageId for thread ${threadId} to update embed.`);
        return;
    }

    try {
        const channel = await client.channels.fetch(raidInfo.originalChannelId);
        const message = await channel.messages.fetch(raidInfo.messageId);
        const originalEmbed = message.embeds[0];

        if (!originalEmbed) {
            console.error(`Original embed not found for message ${raidInfo.messageId} when trying to update embed.`);
            return;
        }

        const updatedEmbed = new EmbedBuilder(originalEmbed.data);

        // Update title if provided
        if (updates.title) {
            updatedEmbed.setTitle(updates.title);
        }
        // Update description if provided
        if (updates.description) {
            updatedEmbed.setDescription(updates.description);
        }
        // Update color if provided
        if (updates.color) {
            updatedEmbed.setColor(updates.color);
        }

        // Update fields if provided. This logic is more complex as it needs to preserve non-updated fields.
        if (updates.fields) {
            const newFieldsMap = new Map(updates.fields.map(f => [f.name, f]));
            const combinedFields = originalEmbed.fields.map(originalField => {
                // If the field name exists in newFieldsMap, use the new field
                if (newFieldsMap.has(originalField.name)) {
                    const newField = newFieldsMap.get(originalField.name);
                    // Merge properties, preferring new ones but keeping inline if not specified
                    return {
                        name: newField.name,
                        value: newField.value,
                        inline: newField.inline !== undefined ? newField.inline : originalField.inline
                    };
                }
                return originalField; // Keep original field if not updated
            });

            // Add any completely new fields that weren't in the original embed
            updates.fields.forEach(newField => {
                if (!originalEmbed.fields.some(originalField => originalField.name === newField.name)) {
                    combinedFields.push(newField);
                }
            });

            updatedEmbed.setFields(combinedFields);
        }

        updatedEmbed.setTimestamp(); // Update timestamp to show last modification

        await message.edit({ embeds: [updatedEmbed] });
        console.log(`Updated embed for raid in thread ${threadId}`);

    } catch (error) {
        console.error(`Failed to update embed for thread ${threadId}:`, error);
    }
}
