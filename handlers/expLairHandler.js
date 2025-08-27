// handlers/expLairHandler.js
// This file is responsible for handling the completion and cancellation of raid tickets (channels),
// calculating and awarding EXP points to raid helpers, updating the leaderboard,
// and allowing the raid requester to edit raid tasks.

// Import necessary Discord.js components for UI elements and message types.
import {
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    ALLOWED_TASK_NAMES,
    MAX_XP_PER_RAID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    TASK_MAP_CATEGORIES,
    RAID_CATEGORY_ID
} from '../config/constants.js';
import { updateLeaderboard } from './leaderboardCore.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsHandler.js';
import {
    updateRaidStatus, // Now renames the channel and updates DB status
    getEditTaskModal,
    updateRaidLogEmbed,
    getRaidInfo,
    updateRaid,
    deleteRaid // Now deletes the channel and DB entry
} from '../activeRaidState.js';
import { sendLeaderboardBackup } from './backupHandler.js';

// --- Constants for Embed Colors ---
const COLOR_SUCCESS = 0x57F287; // Green (for final completion)
const COLOR_CANCELLED = 0xFF4500; // Red
const COLOR_INFO = 0x0099ff; // Blue
const COLOR_PENDING = 0xFFA500; // Orange (for manager review)


function isAdmin(source) {
    const member = source.member;
    if (!member) {
        console.warn('isAdmin called for a source without a member object.');
        return false;
    }
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

async function isAuthorizedToManageRaid(interaction, raidInfo) {
    if (interaction.user.id === raidInfo.requesterId || isAdmin(interaction)) {
        return true;
    }
    await interaction.reply({
        content: 'Only the user who initiated this raid or a staff member can perform this action.',
        flags: MessageFlags.Ephemeral
    });
    return false;
}

async function isStaff(interaction) {
    if (isAdmin(interaction)) {
        return true;
    }
    await interaction.reply({
        content: 'Only staff members can perform this action.',
        flags: MessageFlags.Ephemeral
    });
    return false;
}

function extractUserIds(text) {
    return (text.match(/<@!?(\d+)>/g) || []).map(mention =>
        mention.replace(/<@!?(\d+)>/, '$1')
    );
}

function parseHelperAssignments(content) {
    const helperAssignments = {}; // Stores { 'taskName': { users: Set<string>, multiplier: number } }
    const globalTaggedUsers = new Set();
    let globalMultiplier = 1;
    let hasValidTags = false;
    const unrecognizedTasks = new Set();
    const linesWithNoValidUsers = new Set(); 

    const lines = content.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Handle "all xN = @user1 @user2" or "all xN : @user1 @user2" assignments
        const allMatch = trimmedLine.match(/^all(\s*x(\d+))?\s*[=:]\s*(.*)/i);
        if (allMatch) {
            globalMultiplier = allMatch[2] ? parseInt(allMatch[2], 10) : 1;
            if (isNaN(globalMultiplier) || globalMultiplier < 1) {
                unrecognizedTasks.add(`all${allMatch[1] || ''}`);
                globalMultiplier = 1; // Reset to default
                continue;
            }
            const userIds = extractUserIds(allMatch[3]);
            userIds.forEach(userId => globalTaggedUsers.add(userId));
            if (userIds.length > 0) hasValidTags = true;
            continue;
        }

        // Handle assignments and seperators '=' and ':'
        const parts = trimmedLine.split(/=|:/);
        if (parts.length < 2) {
            if (trimmedLine.length > 0) {
                unrecognizedTasks.add(trimmedLine);
            }
            continue;
        }

        const taskString = parts[0].trim();
        const userMentionPart = parts.slice(1).join(parts[0].includes('=') ? '=' : ':').trim(); // Re-join with the detected separator

        const userIds = extractUserIds(userMentionPart);

        if (userIds.length === 0) {
            linesWithNoValidUsers.add(trimmedLine);
            continue;
        }
        hasValidTags = true;

        // Split the taskString by '+' to handle multiple tasks in one line
        const individualTaskEntries = taskString.split('+').map(t => t.trim());

        userIds.forEach(userId => {
            individualTaskEntries.forEach(entry => {
                // Now, parse each individual entry for its name and potential multiplier
                const individualTaskMatch = entry.match(/^(.+?)(x(\d+))?$/i);
                if (!individualTaskMatch) {
                    unrecognizedTasks.add(entry);
                    return;
                }

                let taskName = individualTaskMatch[1].trim().toLowerCase();
                const taskMultiplierStr = individualTaskMatch[3];
                const taskMultiplier = taskMultiplierStr ? parseInt(taskMultiplierStr, 10) : 1;

                if (isNaN(taskMultiplier) || taskMultiplier < 1) {
                    unrecognizedTasks.add(entry);
                    return;
                }

                // Allow meta-tasks like 'daily' and 'weekly'
                if (ALLOWED_TASK_NAMES.includes(taskName) || TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
                    if (!helperAssignments[taskName]) {
                        helperAssignments[taskName] = { users: new Set(), multiplier: taskMultiplier };
                    }
                    helperAssignments[taskName].users.add(userId);
                    // Ensure the multiplier is the maximum of any assigned in the line.
                    helperAssignments[taskName].multiplier = Math.max(helperAssignments[taskName].multiplier, taskMultiplier);
                } else {
                    unrecognizedTasks.add(entry);
                }
            });
        });
    }
    return { helperAssignments, globalTaggedUsers, globalMultiplier, hasValidTags, unrecognizedTasks, linesWithNoValidUsers };
}

function calculateTaskPoints(tasks) {
    let uniqueEffectiveTasks = new Set();

    tasks.forEach(task => {
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            TASK_MAP_CATEGORIES[task].forEach(t => uniqueEffectiveTasks.add(t));
        } else if (POINTS_CONFIG[task]) {
            uniqueEffectiveTasks.add(task);
        }
    });

    let totalPoints = 0;
    uniqueEffectiveTasks.forEach(taskName => {
        totalPoints += (POINTS_CONFIG[taskName] || 0);
    });

    return Math.min(totalPoints, MAX_XP_PER_RAID);
}

async function finalizeRaid(client, channelId, raidInfo, completionData, completionInitiatorId, managerConfirmationMessageId = null) {
    const { pointsAwarded, helperSummaries, unrecognizedTasks, linesWithNoValidUsers, mismatchedTasks, attachmentUrl } = completionData;

    try {
        const raidTicketChannel = await client.channels.fetch(channelId);
        if (!raidTicketChannel || raidTicketChannel.type !== ChannelType.GuildText) {
            console.error(`Raid ticket channel ${channelId} not found or is not a text channel for finalization.`);
            // No need to reply here as the manager likely confirmed already.
            return;
        }

        // Delete the manager confirmation message if it exists
        if (managerConfirmationMessageId) {
            try {
                const messageToDelete = await raidTicketChannel.messages.fetch(managerConfirmationMessageId);
                await messageToDelete.delete();
            } catch (err) {
                console.warn(`Could not delete manager confirmation message ${managerConfirmationMessageId} in channel ${channelId}:`, err.message);
            }
        }

        // Update channel name to indicate final completion
        await updateRaidStatus(client, channelId, 'Completed', COLOR_SUCCESS);

        const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel. Cannot post completion details.');
            // Send a warning to the completion initiator if possible
            const requester = await client.users.fetch(completionInitiatorId);
            if (requester) {
                requester.send(`Raid ${raidTicketChannel.name} was completed, but I could not post the details to the EXP Lair channel. Please check bot permissions.`)
                    .catch(e => console.error(`Failed to DM requester ${requester.id}:`, e));
            }
            // Proceed to delete channel even if EXP Lair failed.
            await deleteRaid(channelId);
            await raidTicketChannel.delete('Raid completed and closed, but EXP Lair post failed.');
            return;
        }

        // Fetch display names and mentions for all helpers.
        const helperDisplayNames = [];
        const helperMentions = []; // Store mentions for the embed
        const allHelperIds = Object.keys(pointsAwarded);
        for (const id of allHelperIds) {
            try {
                const member = await raidTicketChannel.guild.members.fetch(id);
                helperDisplayNames.push(member.displayName);
                helperMentions.push(`<@${id}>`); // Add mention for the embed
            } catch (err) {
                console.error(`Error fetching member ${id}:`, err);
                helperDisplayNames.push(`User-${id}`); // Fallback
                helperMentions.push(`User-${id}`); // Fallback for mention too
            }
        }
        const helpersStringForEmbed = helperMentions.length > 0 ? helperMentions.join(', ') : 'None';

        const requesterMember = await raidTicketChannel.guild.members.fetch(raidInfo.requesterId);

        // Construct and send embed to EXP Lair Channel
        const embed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle(`Raid Completion Report`)
            .setDescription(
                `**Raid requested by:** ${requesterMember}\n` +
                `**Task(s):** ${raidInfo.task}\n` +
                `**Helpers:** ${helpersStringForEmbed}` // Use mentions here
            )
            .setTimestamp()
            .setFooter({ text: 'Raid Completion Details' });

        if (attachmentUrl) {
            embed.setImage(attachmentUrl);
        }

        const sentExpLairMessage = await expLairChannel.send({
            content: `Raid completed for ${requesterMember.displayName}.`,
            embeds: [embed]
        });

        // Create a thread in EXP Lair for detailed breakdown (this still functions as before)
        const expLairThread = await sentExpLairMessage.startThread({
            name: `COMPLETED Raid for ${requesterMember.displayName}`,
            autoArchiveDuration: 60
        });

        let expLairThreadContent = `This thread contains the full details for the raid.\n\n**Task Initially Requested:** ${raidInfo.task}\n**Points Breakdown:**\n`;

        if (Object.keys(pointsAwarded).length > 0) {
            for (const userId in pointsAwarded) {
                const member = await raidTicketChannel.guild.members.fetch(userId);
                expLairThreadContent += `${member.displayName}: ${pointsAwarded[userId]} EXP\n`; // Use display name here
            }
        } else {
            expLairThreadContent += `No standard EXP awarded based on submission.`;
        }

        expLairThreadContent += `\n**Helper Assignments Breakdown:** \n${helperSummaries.join('\n')}\n`;

        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`\n**Note**: The following tasks were not recognized and earned no points: ${unrecognizedList}. Use valid task names from \`!raidtasks\`.\n`);
        }

        if (linesWithNoValidUsers.size > 0) {
            const invalidUserLinesList = Array.from(linesWithNoValidUsers).map(line => `\`${line}\``).join('\n');
            expLairThreadContent += (`\n**Warning**: The following lines were ignored because no valid users were tagged (e.g., only roles were mentioned, or no one was tagged):\n${invalidUserLinesList}\n`);
        }

        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`\n**Warning**: These tasks weren't part of the original raid (**${raidInfo.task}**) and earned no points: ${mismatchedList}.`);
        }

        await expLairThread.send({ content: expLairThreadContent });

        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }

        if (Object.keys(pointsAwarded).length > 0) {
            await sendLeaderboardBackup(client);
        }

        // Send a final message to the ticket channel before deletion
        await raidTicketChannel.send(`Raid completed, this ticket channel will now be deleted.`)
            .catch(e => console.error(`Error sending final message to ${channelId}:`, e));

        await deleteRaid(channelId); // Delete from DB
        await raidTicketChannel.delete('Raid completed and closed.'); // Delete the Discord channel
    } catch (error) {
        console.error('Error processing raid finalization:', error);
        const raidTicketChannel = await client.channels.fetch(channelId);
        if (raidTicketChannel) {
            raidTicketChannel.send('There was an error during final raid processing. Please contact staff.');
        }
        // Attempt to reset to active state if something went wrong but channel still exists
        await updateRaid(channelId, { status: 'active', awaitingCompletion: false, pendingData: null });
    }
}

async function presentRaidCompletionForManagerReview(
    message,
    raidInfo,
    pointsAwarded,
    helperSummaries,
    unrecognizedTasks,
    linesWithNoValidUsers,
    mismatchedTasks,
    attachment
) {
    const raidTicketChannel = message.channel;
    const channelId = raidTicketChannel.id;

    // Construct the embed for manager review
    const managerEmbed = new EmbedBuilder()
        .setColor(COLOR_INFO)
        .setTitle('Raid Completion Pending Manager Review')
        .setDescription(
            `<@&${RAID_MANAGER_ROLE_ID}>: A raid completion has been submitted and requires your review.\n` +
            `**Requested by:** <@${raidInfo.requesterId}>\n` +
            `**Original Task(s):** ${raidInfo.task}`
        )
        .addFields(
            { name: 'Proposed Points Awarded', value: Object.keys(pointsAwarded).length > 0 ? Object.keys(pointsAwarded).map(id => `<@${id}>: ${pointsAwarded[id]} EXP`).join('\n') : 'No points proposed.', inline: false },
            { name: 'Helper Assignments Summary', value: helperSummaries.length > 0 ? helperSummaries.join('\n') : 'No specific assignments parsed.', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Review this submission before finalizing.' });

    if (attachment) {
        managerEmbed.setImage(attachment.url);
    }

    let warningText = '';
    if (unrecognizedTasks.size > 0) {
        const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
        warningText += `\n- Unrecognized tasks: ${unrecognizedList}`;
    }
    if (linesWithNoValidUsers.size > 0) {
        const invalidUserLinesList = Array.from(linesWithNoValidUsers).map(line => `\`${line}\``).join('\n');
        warningText += `\n- Lines with no valid users: ${invalidUserLinesList}`;
    }
    if (mismatchedTasks.size > 0) {
        const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
        warningText += `\n- Tasks not part of original request: ${mismatchedList}`;
    }
    if (warningText) {
        managerEmbed.addFields({ name: '⚠️ Warnings in Submission', value: warningText, inline: false });
    }

    const confirmButton = new ButtonBuilder()
        .setCustomId('confirmPendingRaid')
        .setLabel('✅ Confirm & Finalize')
        .setStyle(ButtonStyle.Success);

    const overrideButton = new ButtonBuilder()
        .setCustomId('overridePendingRaid')
        .setLabel('🔄 Override & Edit')
        .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder().addComponents(confirmButton, overrideButton);

    try {
        // Update the raid channel name and status
        await updateRaidStatus(message.client, channelId, 'Completed', COLOR_SUCCESS);
        
        // Update the raid channel name to indicate pending review
        const newChannelName = `Completed-Raid`;
        await message.channel.setName(newChannelName, `Status change to ${newChannelName}`);   

        const managerMessage = await raidTicketChannel.send({
            content: `<@&${RAID_MANAGER_ROLE_ID}>`,
            embeds: [managerEmbed],
            components: [actionRow]
        });

        // Store the completion data and manager message ID in the raid state for later retrieval
        await updateRaid(channelId, {
            status: 'pending_manager_review', 
            awaitingCompletion: false, 
            awaitingCompletionRequesterId: null, 
            pendingData: {
                pointsAwarded: pointsAwarded,
                helperSummaries: helperSummaries,
                unrecognizedTasks: Array.from(unrecognizedTasks),
                linesWithNoValidUsers: Array.from(linesWithNoValidUsers),
                mismatchedTasks: Array.from(mismatchedTasks),
                attachmentUrl: attachment ? attachment.url : null,
                completionInitiatorId: message.author.id, // Store who initiated the completion
                managerConfirmationMessageId: managerMessage.id // Store this message ID
            }
        });
        console.log(`Raid ${channelId} now pending manager review. Data stored.`);
    } catch (error) {
        console.error('Error presenting raid completion for manager review:', error);
        await message.reply('There was an error submitting the raid for manager review. Please try again.');
        // Reset the raid to active if there was an error in the review process
        await updateRaid(channelId, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null, pendingData: null });
    }
}


async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, globalMultiplier, unrecognizedTasks, linesWithNoValidUsers } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();

    // Helper function to validate users (not requester, not bot) and get display names
    const filterAndGetValidUsers = async (userIds) => {
        const validUsers = {};
        for (const userId of userIds) {
            // Requester cannot award themselves points
            if (userId === raidInfo.requesterId) {
                try {
                    const requesterMember = await message.guild.members.fetch(raidInfo.requesterId);
                    await message.channel.send(`Heads up! The requester cannot award themselves points. Ignoring **${requesterMember.displayName}** for this submission.`, { flags: MessageFlags.Ephemeral });
                } catch (error) {
                    console.error(`Could not fetch requester member ${raidInfo.requesterId} for warning:`, error);
                    await message.channel.send(`Heads up! The requester cannot award themselves points. Ignoring <@${raidInfo.requesterId}> for this submission.`, { flags: MessageFlags.Ephemeral });
                }
                continue;
            }
            try {
                const member = await message.guild.members.fetch(userId);
                // Bots cannot be awarded points (re-adding this check as it was commented out)
                /*if (member.user.bot) {
                    await message.channel.send(`Heads up! Bots cannot be awarded points. Ignoring **${member.displayName}** for this submission.`, { flags: MessageFlags.Ephemeral });
                    continue;
                }*/
                validUsers[userId] = member.displayName;
            } catch (error) {
                console.error(`Could not fetch guild member ${userId} during validation:`, error);
                await message.channel.send(`Warning: Could not verify user <@${userId}>. Skipping them for points.`, { flags: MessageFlags.Ephemeral });
            }
        }
        return validUsers;
    };

    const pointsAwarded = {};
    const helperSummaries = [];
    const mismatchedTasks = new Set(); // Tasks mentioned that were not part of the original request
    const assignedUsers = new Set(); // To track users already assigned specific tasks

    // Determine the original tasks requested for this raid, including expanded meta-tasks
    const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
    const originalRaidEffectiveTasks = new Set(); // Individual tasks (e.g., speaker, dage)
    const originalRaidRequestedStrings = new Set(); // Original strings (e.g., daily, speaker)

    originalRequestedTasksRaw.forEach(task => {
        originalRaidRequestedStrings.add(task); // Store 'daily' or 'speaker'
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            // Expand meta-tasks like 'daily' into their components
            TASK_MAP_CATEGORIES[task].forEach(t => originalRaidEffectiveTasks.add(t));
        } else if (ALLOWED_TASK_NAMES.includes(task)) {
            originalRaidEffectiveTasks.add(task);
        }
    });

    // --- Process specific task assignments first ---
    for (const taskName in helperAssignments) {
        const { users, multiplier } = helperAssignments[taskName];
        const validUsers = await filterAndGetValidUsers(users); // Validate users for this task
        const usersForTask = Object.keys(validUsers);

        if (usersForTask.length === 0) continue; // No valid users for this specific task assignment

        let isValidAssignedTask = false;
        // Check if the assigned task matches an original requested string OR an effective task from a meta-category
        if (originalRaidRequestedStrings.has(taskName) || originalRaidEffectiveTasks.has(taskName)) {
            isValidAssignedTask = true;
        } else if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
            // If the assigned task is a meta-category, check if ALL its sub-tasks were part of the original request
            const metaCategoryTasks = TASK_MAP_CATEGORIES[taskName];
            if (metaCategoryTasks.every(metaTask => originalRaidEffectiveTasks.has(metaTask))) {
                isValidAssignedTask = true;
            }
        }

        if (!isValidAssignedTask) {
            mismatchedTasks.add(taskName + (multiplier > 1 ? `x${multiplier}` : ''));
            continue; // Skip points for mismatched tasks
        }

        let pointsForThisTask = calculateTaskPoints([taskName]) * multiplier;

        if (pointsForThisTask > 0) {
            const helperNames = Object.values(validUsers).join(', ');
            helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${pointsForThisTask} EXP each)`);
            usersForTask.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + pointsForThisTask;
                assignedUsers.add(userId); // Mark user as assigned for specific tasks
            });
        }
    }

    // --- Process global 'all' assignments for users not already specifically assigned ---
    const unassignedGlobalTaggedUsers = Array.from(globalTaggedUsers).filter(id => !assignedUsers.has(id));
    const validGlobalTaggedUsers = await filterAndGetValidUsers(new Set(unassignedGlobalTaggedUsers)); // Validate users
    
    if (Object.keys(validGlobalTaggedUsers).length > 0) {
        const tasksForGlobalHelpers = Array.from(originalRaidEffectiveTasks); // All effective tasks from original request
        let totalPointsForGlobalHelpers = calculateTaskPoints(tasksForGlobalHelpers) * globalMultiplier;

        const helperNames = Object.values(validGlobalTaggedUsers).join(', ');
        helperSummaries.push(`**All Tasks:** ${helperNames} (${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfo.task}${globalMultiplier > 1 ? ` x${globalMultiplier}` : ''})`);
        
        Object.keys(validGlobalTaggedUsers).forEach(userId => {
            pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
        });
    }

    // --- Final validation and warnings before completing the raid ---
    if (Object.keys(pointsAwarded).length === 0) {
        await updateRaid(message.channel.id, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null, pendingData: null });
        await message.reply({
            content: 'No valid players were found or no points could be assigned based on your submission. Please use the `Close Raid` button to try again with correct formatting and valid users.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Apply MAX_XP_PER_RAID to each user's total points
    for (const userId in pointsAwarded) {
        pointsAwarded[userId] = Math.min(pointsAwarded[userId], MAX_XP_PER_RAID);
    }

    // --- NEW: Instead of finalizing, present for manager review ---
    await presentRaidCompletionForManagerReview(
        message,
        raidInfo,
        pointsAwarded,
        helperSummaries,
        unrecognizedTasks,
        linesWithNoValidUsers,
        mismatchedTasks,
        attachment
    );
}

async function handleRaidCancellation(message, raidInfo) {
    const channelId = message.channel.id;
    const raidTicketChannel = message.channel;

    try {
        // Update channel name to indicate cancellation
        await updateRaidStatus(message.client, channelId, 'cancelled', COLOR_CANCELLED);

        await message.reply('Raid ticket closed without helpers/screenshot. Channel will be deleted.');
        await deleteRaid(channelId); // Delete from DB
        await raidTicketChannel.delete('Raid cancelled and closed.'); // Delete the Discord channel
    } catch (error) {
        console.error('Error processing raid cancellation:', error);
        await raidTicketChannel.send('There was an error processing the raid cancellation. Please contact staff.');
        // If deletion fails, ensure the raid status is reset
        await updateRaid(channelId, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null, pendingData: null });
    }
}


export function setupExpLairHandlers(client) {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        // Check if the message is in a raid ticket channel
        const raidInfo = await getRaidInfo(message.channel.id);
        const isRaidTicketChannel = raidInfo && message.channel.type === ChannelType.GuildText && message.channel.parentId === RAID_CATEGORY_ID;

        if (!isRaidTicketChannel) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();

        // Only process completion/cancellation messages if the raid is in 'awaiting_user_input' state
        if (raidInfo.status === 'awaiting_user_input') {
            if (message.author.id !== raidInfo.awaitingCompletionRequesterId) {
                // Only the person who initiated 'closeRaidTicket' can submit completion/cancellation
                await message.reply({ content: 'Only the raid requester can submit completion details or cancel the raid at this stage.', flags: MessageFlags.Ephemeral });
                return;
            }

            // Handle standard cancellation
            if (contentLower === 'cancel' && message.mentions.users.size === 0 && !message.attachments.first()) {
                await handleRaidCancellation(message, raidInfo);
                return;
            }

            // If not 'cancel', then attempt to handle as completion
            await handleRaidCompletion(message, raidInfo);
            return;
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        // Check if the interaction is in a raid ticket channel
        const raidInfo = await getRaidInfo(interaction.channel.id);
        const isRaidTicketChannel = raidInfo && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;


        if (!isRaidTicketChannel) {
            // Only reply ephemerally if the customId matches our buttons/modals
            if (interaction.isButton() && (interaction.customId === 'closeRaidTicket' || interaction.customId === 'editTask_btn' || interaction.customId === 'confirmPendingRaid' || interaction.customId === 'overridePendingRaid')) {
                await interaction.reply({ content: 'This button can only be used in a raid ticket channel.', flags: MessageFlags.Ephemeral });
            } else if (interaction.isModalSubmit() && interaction.customId === 'editTaskModal') {
                await interaction.reply({ content: 'This action can only be performed in a raid ticket channel.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // If raidInfo was not found, it means this channel is not a recognized raid ticket.
        // This check is important as channel might have been deleted but interaction still comes through.
        if (!raidInfo) {
            console.warn(`Raid info not found in DB/cache for channel ${interaction.channel.id}. Cannot process interaction.`);
            await interaction.reply({ content: 'Could not retrieve raid details. This raid might have been completed or cancelled (channel deleted).', flags: MessageFlags.Ephemeral });
            return;
        }

        // Handle buttons
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'closeRaidTicket':
                    if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
                        return;
                    }
                    if (raidInfo.status === 'pending_manager_review') {
                        await interaction.reply({
                            content: 'This raid is currently awaiting manager review. Please wait for staff to process it or use "Override & Edit" if you are a staff member.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    
                    await updateRaid(interaction.channel.id, {
                        status: 'awaiting_user_input',
                        awaitingCompletionRequesterId: interaction.user.id,
                        pendingData: null // Clear any old pending data
                    });
                    console.log(`Channel ${interaction.channel.id} now awaiting completion details from ${interaction.user.tag}.`);

                    await interaction.reply({
                        content:
                            'Mention those who helped e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 : @user1 @user2`'
                            + `\n* You can use \`All\` to refer to every requested task (e.g., \`all x2 = @user1 @user2\` for multiple runs)`
                            + `\n* Include a screenshot if possible.`
                            + `\n* You can type \`cancel\` to close the ticket without tagging helpers.`
                            + `\n* For multiple tasks, use \`task1 + task2 = @user\``
                            + `\n* For multiple runs of the same tasks, a multiplier can done \`task1xN = @user\` format.`,
                        flags: MessageFlags.Ephemeral
                    });
                    break;

                case 'editTask_btn':
                    if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
                        return;
                    }
                    if (raidInfo.status === 'pending_manager_review') {
                        await interaction.reply({
                            content: 'This raid is currently awaiting manager review. Tasks cannot be edited until the review is resolved. Staff can use "Override & Edit" to revert the state.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    const editTaskModal = getEditTaskModal(raidInfo.task);
                    await interaction.showModal(editTaskModal);
                    break;

                case 'confirmPendingRaid':
                    if (!await isStaff(interaction)) {
                        return;
                    }
                    if (raidInfo.status !== 'pending_manager_review' || !raidInfo.pendingData) {
                        await interaction.reply({ content: 'This raid is not in a pending review state or has no pending data to confirm.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    await interaction.deferUpdate(); // Defer the button click
                    console.log(`Manager ${interaction.user.tag} confirming raid ${interaction.channel.id}.`);

                    // Retrieve the stored completion data
                    const completionData = {
                        pointsAwarded: raidInfo.pendingData.pointsAwarded,
                        helperSummaries: raidInfo.pendingData.helperSummaries,
                        unrecognizedTasks: new Set(raidInfo.pendingData.unrecognizedTasks || []),
                        linesWithNoValidUsers: new Set(raidInfo.pendingData.linesWithNoValidUsers || []),
                        mismatchedTasks: new Set(raidInfo.pendingData.mismatchedTasks || []),
                        attachmentUrl: raidInfo.pendingData.attachmentUrl
                    };

                    await finalizeRaid(client, interaction.channel.id, raidInfo, completionData, raidInfo.pendingData.completionInitiatorId, raidInfo.pendingData.managerConfirmationMessageId);
                    break;

                case 'overridePendingRaid':
                    if (!await isStaff(interaction)) {
                        return;
                    }
                    if (raidInfo.status !== 'pending_manager_review') {
                        await interaction.reply({ content: 'This raid is not in a pending review state.', flags: MessageFlags.Ephemeral });
                        return;
                    }


                    await interaction.deferUpdate();
                    console.log(`Manager ${interaction.user.tag} overriding pending raid ${interaction.channel.id}.`);


                    await updateRaidStatus(client, interaction.channel.id, 'waiting', raidInfo.color);


                    await updateRaid(interaction.channel.id, {
                    status: 'waiting',
                    awaitingCompletion: false,
                    awaitingCompletionRequesterId: null,
                    pendingData: null
                    });


                    if (raidInfo.pendingData?.managerConfirmationMessageId) {
                    try {
                        const messageToDelete = await interaction.channel.messages.fetch(raidInfo.pendingData.managerConfirmationMessageId);
                        await messageToDelete.delete();
                    } catch (err) {
                        console.warn(`Could not delete manager confirmation message ${raidInfo.pendingData.managerConfirmationMessageId}:`, err.message);
                        }
                    }


                    const requesterMember = await interaction.guild.members.fetch(raidInfo.requesterId);
                    if (!requesterMember) {
                    await interaction.channel.send('Could not find the original raid requester to update the channel name.');
                    return;
                    }
                    const baseName = `${requesterMember.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
                    const newChannelName = `${baseName}-waiting`;
                    await interaction.channel.setName(newChannelName, `Status change to waiting`);


                    await interaction.followUp({
                    content: 'Raid completion submission has been overridden. The raid is now active again, and the requester can resubmit completion details via the `Close Raid` button.',
                    flags: MessageFlags.Ephemeral
                    });
                    break;

                default:
                    break;
            }
        }

        if (interaction.isModalSubmit()) {
            switch (interaction.customId) {
                case 'editTaskModal':
                    // This modal submission is tied to editTask_btn, so the initial restricted state check already applies.
                    if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
                        return;
                    }
                    const editedTasksInput = interaction.fields.getTextInputValue('editedTaskInput').toLowerCase();
                    const newTasksArray = editedTasksInput.split(/\s*\+\s*/).map(t => t.trim());

                    for (const taskName of newTasksArray) {
                        if (!ALLOWED_TASK_NAMES.includes(taskName)) {
                            await interaction.reply({
                                content: `Invalid task "${taskName}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                                embeds: [getCombinedTasksAndPointsEmbed()],
                                flags: MessageFlags.Ephemeral
                            });
                            return;
                        }
                    }

                    const newRaidTaskString = newTasksArray.join(' + ');

                    await updateRaid(interaction.channel.id, { task: newRaidTaskString });

                    // We need to update the initial embed in the ticket channel with the new tasks
                    await updateRaidLogEmbed(
                        client,
                        interaction.channel.id, // Pass the ticket channel ID
                        {
                            fields: [
                                { name: 'Task(s)', value: newRaidTaskString, inline: false }
                            ]
                        }
                    );

                    await interaction.reply({ content: `Successfully updated raid tasks to "${newRaidTaskString}"!`, flags: MessageFlags.Ephemeral });
                    break;

                default:
                    break;
            }
        }
    });
}
