// activeRaidState.js

import { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createRaidState, deleteRaidState, getRaidState, getRaidStateMinimal, updateRaidState } from './utils/dbOps.js';

// Cache for active raid tickets to reduce database reads.
const raidStateCache = new Map();
const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

const raidStateMinimalCache = new Map();
const MINIMAL_CACHE_LIFETIME_MS = 30 * 1000; // 30 seconds


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
        const raidInfo = await getRaidState(channelId);
        if (raidInfo) {
            raidStateCache.set(channelId, { data: raidInfo, timestamp: Date.now() });
        }
        return raidInfo;
    } catch (error) {
        console.error(`Error fetching raid info for ticket ${channelId}:`, error);
        return null;
    }
}

export async function getRaidInfoMinimal(channelId) {
    if (raidStateMinimalCache.has(channelId)) {
        const cachedEntry = raidStateMinimalCache.get(channelId);
        if (Date.now() - cachedEntry.timestamp < MINIMAL_CACHE_LIFETIME_MS) {
            return cachedEntry.data;
        } else {
            raidStateMinimalCache.delete(channelId);
        }
    }

    try {
        const raidInfo = await getRaidStateMinimal(channelId);
        if (raidInfo) {
            raidStateMinimalCache.set(channelId, { data: raidInfo, timestamp: Date.now() });
        }
        return raidInfo;
    } catch (error) {
        console.error(`Error fetching minimal raid info for ticket ${channelId}:`, error);
        return null;
    }
}

export async function createRaid(channelId, raidDetails) {
    try {
        const document = { ...raidDetails };
        await createRaidState(channelId, document);
        raidStateCache.set(channelId, { data: { id: String(channelId), ...document }, timestamp: Date.now() });
    } catch (error) {
        console.error(`Error creating raid ${channelId} in DB:`, error);
        throw error;
    }
}

export async function updateRaid(channelId, updates) {
    try {
        if (updates.pendingData !== undefined) {
            delete updates.pendingData;
        }

        await updateRaidState(channelId, updates);
        raidStateCache.delete(channelId); // Invalidate cache
        console.log(`Raid ${channelId} updated in DB.`);
    } catch (error) {
        console.error(`Error updating raid ${channelId} in DB:`, error);
        throw error;
    }
}

export async function deleteRaid(channelId) {
    try {
        await deleteRaidState(channelId);
        raidStateCache.delete(channelId);
        console.log(`Raid ${channelId} deleted from DB.`);
    } catch (error) {
        console.error(`Error deleting raid ${channelId} from DB:`, error);
        throw error;
    }
}


export async function updateRaidStatus(client, channelId, newStatus) {
    const raidInfo = await getRaidInfo(channelId); 
    if (!raidInfo || !raidInfo.messageId || !raidInfo.originalChannelId) {
        console.log(`Could not find raid info or messageId for ticket ${channelId} to update status.`);
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

        const STATUS_COLORS = { Waiting: EMBED_COLOR, Full: 0xdd2e44, Ongoing: 0x78b159 };
        const nextColor = STATUS_COLORS[newStatus] ?? EMBED_COLOR;

        const updatedEmbed = new EmbedBuilder(originalEmbed.data)
            .setFields(
                originalEmbed.fields.map(field => {
                    if (field.name === 'Status') {
                        return { name: 'Status', value: newStatus, inline: true };
                    }
                    return field;
                })
            )
            .setColor(nextColor)
            .setTimestamp(); 
        
        await message.edit({ embeds: [updatedEmbed] });
        console.log(`Updated status to "${newStatus}" for raid in ticket ${channelId}`);

        await updateRaid(channelId, { status: newStatus });
        

    } catch (error) {
        console.error(`Failed to update raid status for ticket ${channelId}:`, error);
    }
}

export function getEditTaskModal(currentTasks, currentMap, currentNumber, currentServer, size, description) {
    
    let taskPlaceHolder = ("Daily, Weeklies, Originul, etc.");
    let mapPlaceHolder = ("/join ultraspeaker-1212, /join voidflibbi-3434, etc.");
    switch(size) {
        case '4-man':
            taskPlaceHolder = "daily, dage, weeklies, templeshrine";
            mapPlaceHolder = "ultraspeaker, championdrakath, tyndarius etc.";
            break;
        case '7-man':
            taskPlaceHolder = "originul, astralshrine, kathooldepths";
            mapPlaceHolder = "voidflibbi, deimos, grimchallenge etc.";
            break;
        }

    const modal = new ModalBuilder()
        .setCustomId('editTaskModal')
        .setTitle('Edit Raid Task(s)');

    const taskInput = new TextInputBuilder()
        .setCustomId('editedTaskInput')
        .setLabel("Current Task(s): ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(taskPlaceHolder)
        .setValue(currentTasks);

    const mapInput = new TextInputBuilder()
        .setCustomId('editedMapInput')
        .setLabel("Map Name: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(mapPlaceHolder)
        .setValue(currentMap);

    const mapNumberInput = new TextInputBuilder()
        .setCustomId('editedMapNumberInput')
        .setLabel("Map Number: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("2323, 1212")
        .setValue(currentNumber);

    const serverInput = new TextInputBuilder()
        .setCustomId('editedServerInput')
        .setLabel("Server Name: ") 
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria')
        .setValue(currentServer);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('editedDescriptionInput')
        .setLabel("Description: ")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Any specific details or requirements?')
        .setValue(description);

    const row1 = new ActionRowBuilder().addComponents(taskInput);
    const row2 = new ActionRowBuilder().addComponents(mapInput);
    const row3 = new ActionRowBuilder().addComponents(mapNumberInput);      
    const row4 = new ActionRowBuilder().addComponents(serverInput);    
    const row5 = new ActionRowBuilder().addComponents(descriptionInput);    
    modal.addComponents(row1, row2, row3, row4, row5);
    return modal;
}

export async function updateRaidLogEmbed(client, channelId, updates) {
    const raidInfo = await getRaidInfo(channelId); // Fetch from DB/cache
    if (!raidInfo || !raidInfo.messageId || !raidInfo.originalChannelId) {
        console.log(`Could not find raid info or messageId for ticket ${channelId} to update embed.`);
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
        console.log(`Updated embed for raid in channel ${channelId}`);

    } catch (error) {
        console.error(`Failed to update embed for channel ${channelId}:`, error);
    }
}
