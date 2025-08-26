// activeRaidState.js
// This file manages the state of active raid tickets (now Discord channels)
// and their persistence in the database, including a cache for performance.

import { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { ALLOWED_TASK_NAMES } from './config/constants.js';
import { raidStatesCollection } from './utils/dbOps.js';

// Cache for active raid ticket channels to reduce database reads.
const raidStateCache = new Map();
const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches raid information for a given channel ID.
 * @param {string} channelId The ID of the Discord channel (ticket).
 * @returns {Promise<object | null>} The raid info object, or null if not found.
 */
export async function getRaidInfo(channelId) {
    if (raidStateCache.has(channelId)) {
        const cachedEntry = raidStateCache.get(channelId);
        if (Date.now() - cachedEntry.timestamp < CACHE_LIFETIME_MS) {
            return cachedEntry.data;
        } else {
            raidStateCache.delete(channelId); // Cache expired
        }
    }

    try {
        const raidInfo = await raidStatesCollection.findOne({ _id: channelId });
        if (raidInfo) {
            raidStateCache.set(channelId, { data: raidInfo, timestamp: Date.now() });
        }
        return raidInfo;
    } catch (error) {
        console.error(`Error fetching raid info for channel ${channelId}:`, error);
        return null;
    }
}

export async function createRaid(channelId, raidDetails) {
    try {
        const document = { _id: channelId, ...raidDetails };
        await raidStatesCollection.insertOne(document);
        raidStateCache.set(channelId, { data: document, timestamp: Date.now() });
        console.log(`Raid ticket ${channelId} created in DB.`);
    } catch (error) {
        console.error(`Error creating raid ticket ${channelId} in DB:`, error);
        throw error;
    }
}


export async function updateRaid(channelId, updates) {
    try {
        await raidStatesCollection.updateOne(
            { _id: channelId },
            { $set: updates }
        );
        raidStateCache.delete(channelId); // Invalidate cache
        console.log(`Raid ticket ${channelId} updated in DB.`);
    } catch (error) {
        console.error(`Error updating raid ticket ${channelId} in DB:`, error);
        throw error;
    }
}

/**
 * Deletes a raid entry from the database.
 * @param {string} channelId The ID of the Discord channel (ticket).
 * @returns {Promise<void>}
 */
export async function deleteRaid(channelId) {
    try {
        await raidStatesCollection.deleteOne({ _id: channelId });
        raidStateCache.delete(channelId);
        console.log(`Raid ticket ${channelId} deleted from DB.`);
    } catch (error) {
        console.error(`Error deleting raid ticket ${channelId} from DB:`, error);
        throw error;
    }
}

export async function updateRaidStatus(client, channelId, newStatusTag, newColor) {
    try {
        const raidInfo = await getRaidInfo(channelId);
        if (!raidInfo) {
            console.warn(`Raid info not found for channel ${channelId}. Cannot update status.`);
            return;
        }

        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.warn(`Channel with ID ${channelId} not found.`);
            return;
        }

        // CORRECTED: Fetch the guild member to get their display name
        const requesterMember = await channel.guild.members.fetch(raidInfo.requesterId);
        if (!requesterMember) {
            console.warn(`Requester member not found for ID ${raidInfo.requesterId}.`);
            return;
        }

        // Generate the new channel name
        const baseName = `${requesterMember.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
        const newChannelName = `${baseName}-${newStatusTag}`;

        await channel.setName(newChannelName, `Status change to ${newStatusTag}`);

        // Update the raid status in the database as well
        await updateRaid(channelId, { status: newStatusTag, color: newColor });

        console.log(`Channel ${channelId} successfully renamed to ${newChannelName}`);
    } catch (error) {
        console.error(`Error renaming channel ${channelId}:`, error);
        // You can decide if you want to throw an error or handle it silently
        throw error;
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

/**
 * Updates fields of the initial embed message within the raid ticket channel.
 * This is used for updating information like tasks, description, etc., but NOT status.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} channelId The ID of the Discord channel (ticket).
 * @param {object} updates An object containing the embed fields to update.
 * @returns {Promise<void>}
 */
export async function updateRaidLogEmbed(client, channelId, updates) {
    const raidInfo = await getRaidInfo(channelId);
    if (!raidInfo || !raidInfo.messageId || !raidInfo.originalChannelId) {
        console.log(`Could not find raid info or messageId for channel ${channelId} to update embed.`);
        return;
    }

    try {
        const channel = await client.channels.fetch(raidInfo.originalChannelId); // originalChannelId is now the ticket channel itself
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
        // No direct color update from here, as channel name is status
        // if (updates.color) {
        //     updatedEmbed.setColor(updates.color);
        // }

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
        console.log(`Updated embed for raid in channel ${channelId}`);

    } catch (error) {
        console.error(`Failed to update embed for channel ${channelId}:`, error);
    }
}