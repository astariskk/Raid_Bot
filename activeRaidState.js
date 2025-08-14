// activeRaidState.js

import { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { ALLOWED_TASK_NAMES } from './config/constants.js';
// CHANGED: Import the collection directly from dbOps
import { raidStatesCollection } from './utils/dbOps.js'; 

// Cache for active raid threads to reduce database reads.
const raidStateCache = new Map();
const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

// REMOVED: All of the following code is no longer needed here.
// const DB_NAME = 'raid_bot_db';
// let raidStatesCollection;
// async function initializeRaidStatesCollection() { ... }
// initializeRaidStatesCollection().catch(console.error);

/**
 * Fetches raid information for a given thread ID.
 * @param {string} threadId The ID of the thread.
 * @returns {Promise<object | null>} The raid info object, or null if not found.
 */
export async function getRaidInfo(threadId) {
    if (raidStateCache.has(threadId)) {
        const cachedEntry = raidStateCache.get(threadId);
        if (Date.now() - cachedEntry.timestamp < CACHE_LIFETIME_MS) {
            return cachedEntry.data;
        } else {
            raidStateCache.delete(threadId); // Cache expired
        }
    }

    try {
        // REMOVED: No need to connect or initialize here.
        const raidInfo = await raidStatesCollection.findOne({ _id: threadId });
        if (raidInfo) {
            raidStateCache.set(threadId, { data: raidInfo, timestamp: Date.now() });
        }
        return raidInfo;
    } catch (error) {
        console.error(`Error fetching raid info for thread ${threadId}:`, error);
        return null;
    }
}

/**
 * Creates a new raid entry in the database.
 * @param {string} threadId The ID of the Discord thread.
 * @param {object} raidDetails The details of the raid.
 * @returns {Promise<void>}
 */
export async function createRaid(threadId, raidDetails) {
    try {
        // REMOVED: No need to connect or initialize here.
        const document = { _id: threadId, ...raidDetails };
        await raidStatesCollection.insertOne(document);
        raidStateCache.set(threadId, { data: document, timestamp: Date.now() });
        console.log(`Raid ${threadId} created in DB.`);
    } catch (error) {
        console.error(`Error creating raid ${threadId} in DB:`, error);
        throw error;
    }
}

/**
 * Updates an existing raid entry in the database.
 * @param {string} threadId The ID of the Discord thread.
 * @param {object} updates An object containing the fields to update.
 * @returns {Promise<void>}
 */
export async function updateRaid(threadId, updates) {
    try {
        // REMOVED: No need to connect or initialize here.
        await raidStatesCollection.updateOne(
            { _id: threadId },
            { $set: updates }
        );
        raidStateCache.delete(threadId); // Invalidate cache
        console.log(`Raid ${threadId} updated in DB.`);
    } catch (error) {
        console.error(`Error updating raid ${threadId} in DB:`, error);
        throw error;
    }
}

/**
 * Deletes a raid entry from the database.
 * @param {string} threadId The ID of the Discord thread.
 * @returns {Promise<void>}
 */
export async function deleteRaid(threadId) {
    try {
        // REMOVED: No need to connect or initialize here.
        await raidStatesCollection.deleteOne({ _id: threadId });
        raidStateCache.delete(threadId);
        console.log(`Raid ${threadId} deleted from DB.`);
    } catch (error) {
        console.error(`Error deleting raid ${threadId} from DB:`, error);
        throw error;
    }
}

/**
 * Updates the status on the original raid request embed.
 * This function now fetches raidInfo from the DB via getRaidInfo.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} threadId The ID of the thread where the status update was triggered.
 * @param {string} newStatus The new status string (e.g., 'Ongoing', 'Full', 'Done ✅').
 * @param {number} newColor The new color for the embed.
 */
export async function updateRaidStatus(client, threadId, newStatus, newColor) {
    const raidInfo = await getRaidInfo(threadId); // Fetch from DB/cache
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

export async function updateRaidLogEmbed(client, threadId, updates) {
    const raidInfo = await getRaidInfo(threadId); // Fetch from DB/cache
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
