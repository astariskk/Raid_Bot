// handlers/expLairHandler.js
// This file is responsible for handling the completion and cancellation of raid tickets (channels),
// calculating and awarding EXP points to raid helpers, updating the leaderboard,
// and allowing the raid requester to edit raid tasks.

// Import necessary Discord.js components for UI elements and message types.
import {
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ButtonBuilder,   // For creating buttons
    ButtonStyle,     // For button styles
    ActionRowBuilder // For organizing buttons in rows
} from 'discord.js';
import {
    // channe id's
    EXP_LAIR_CHANNEL_ID,
    RAID_CATEGORY_ID,    

    // role id's 
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_HELPER_ROLE_ID,    

    // other constants
    MAX_XP_PER_RAID,       
    TASK_MAP_CATEGORIES,
    ALLOWED_TASK_NAMES,
    GENERIC_TASKS_LIST,
} from '../config/constants.js';
import { updateLeaderboard } from './leaderboardCore.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsHandler.js';
import {
    updateRaidStatus,
    getEditTaskModal,
    updateRaidLogEmbed,
    getRaidInfo,
    updateRaid,
    deleteRaid
} from '../activeRaidState.js';
import { sendLeaderboardBackup } from './backupHandler.js';
import { calculateTaskPointsWithMultiplier } from '../utils/taskCalculations.js';

// --- Constants for Embed Colors ---
const COLOR_SUCCESS = 0x57F287; // Green (for final completion)
const COLOR_CANCELLED = 0xFF4500; // Red
const COLOR_INFO = 0x0099ff; // Blue


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
    // This regex already correctly handles multiple mentions separated by commas or spaces,
    // as it finds all occurrences of the mention pattern.
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
        const allMatch = trimmedLine.match(/^all(\s*x(\d+))?\s*[=:-]\s*(.*)/i);
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

        // Handle assignments and seperators '=' , ':' and '-'
        const parts = trimmedLine.split(/[:=-]/);
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

        // split tasks by '+' or ','
        const individualTaskEntries = taskString.split(/[+,]/).map(t => t.trim());

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
                    helperAssignments[taskName].multiplier = Math.max(helperAssignments[taskName].multiplier, taskMultiplier);
                } else {
                    unrecognizedTasks.add(entry);
                }
            });
        });
    }
    return { helperAssignments, globalTaggedUsers, globalMultiplier, hasValidTags, unrecognizedTasks, linesWithNoValidUsers };
}

async function finalizeRaid(client, channelId, raidInfo, completionData, completionInitiatorId) {
    const { pointsAwarded, helperSummaries, unrecognizedTasks, linesWithNoValidUsers, mismatchedTasks, attachmentUrl } = completionData;

    try {
        const raidTicketChannel = await client.channels.fetch(channelId);
        if (!raidTicketChannel || raidTicketChannel.type !== ChannelType.GuildText) {
            console.error(`Raid ticket channel ${channelId} not found or is not a text channel for finalization.`);
            return;
        }

        // send message saying raid completed and points awarded
        await raidTicketChannel.send('This raid ticket is now closed');
        
        // --- Change channel name to indicate admin review state ---
        await raidTicketChannel.setName('Pending-raid-review');
        console.log(`Channel ${channelId} renamed to 'Pending-raid-review'.`);

        // Update channel topic to indicate final completion status
        await updateRaidStatus(client, channelId, 'Completed', COLOR_SUCCESS);

        const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        let sentExpLairMessage = null; // Initialize to null, will store the message sent to EXP Lair

        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel. Cannot post completion details.');
            const requester = await client.users.fetch(completionInitiatorId);
            if (requester) {
                await requester.send(`Raid ${raidTicketChannel.name} was completed, but I could not post the details to the EXP Lair channel. Please check bot permissions.`)
                    .catch(e => console.error(`Failed to DM requester ${requester.id}:`, e));
            }
            // Continue the process, but expLairMessageLink will be 'N/A'
        } else {
            // Fetch display names and mentions for all helpers.
            const helperMentions = [];
            const allHelperIds = Object.keys(pointsAwarded);
            for (const id of allHelperIds) {
                try {
                    const member = await raidTicketChannel.guild.members.fetch(id);
                    helperMentions.push(`<@${id}>`);
                } catch (err) {
                    console.error(`Error fetching member ${id}:`, err);
                    helperMentions.push(`User-${id}`); // Fallback for mention
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
                    `**Helpers:** ${helpersStringForEmbed}`
                )
                .setTimestamp()
                .setFooter({ text: 'Raid Completion Details' });
            if (attachmentUrl) {
                embed.setImage(attachmentUrl);
            }

            // check if generic task was included, add description field if so
            const taskList = raidInfo.task.split(/\s*[+,]\s*/).map(t => t.trim());
            const hasGenericTask = taskList.some(task => GENERIC_TASKS_LIST.includes(task));
            if (hasGenericTask && raidInfo.description) {
                embed.addFields({
                    name: 'Description',
                    value: raidInfo.description,
                    inline: false
                });
            }

            try {
                sentExpLairMessage = await expLairChannel.send({
                    content: `Raid completed for ${requesterMember.displayName}.`,
                    embeds: [embed]
                });
            } catch (e) {
                console.error("Failed to send message to EXP Lair channel:", e);
            }

            let expLairThread = null;
            if (sentExpLairMessage) {
                // Create a thread in EXP Lair for detailed breakdown
                try {
                    expLairThread = await sentExpLairMessage.startThread({
                        name: `COMPLETED Raid for ${requesterMember.displayName}`,
                        autoArchiveDuration: 60
                    });

                    let expLairThreadContent = `This thread contains the full details for the raid.\n\n**Task Initially Requested:** ${raidInfo.task}\n**Points Breakdown:**\n`;

                    if (Object.keys(pointsAwarded).length > 0) {
                        for (const userId in pointsAwarded) {
                            const member = await raidTicketChannel.guild.members.fetch(userId);
                            expLairThreadContent += `${member.displayName}: ${pointsAwarded[userId]} EXP\n`;
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
                } catch (e) {
                    console.error("Failed to create EXP Lair thread or send content:", e);
                }
            }
        }

        // Apply EXP to leaderboard
        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }
        if (Object.keys(pointsAwarded).length > 0) {
            await sendLeaderboardBackup(client);
        }

        // --- Step 1: Change channel permissions to be viewable ONLY by admins ---
        const guild = raidTicketChannel.guild;
        const everyoneRole = guild.roles.everyone;
        const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
        const officerRole = guild.roles.cache.get(OFFICER_ROLE_ID);
        const raidManagerRole = guild.roles.cache.get(RAID_MANAGER_ROLE_ID);
        const requester = await guild.members.fetch(raidInfo.requesterId);        

        // Deny @everyone from viewing the channel
        await raidTicketChannel.permissionOverwrites.edit(everyoneRole, {ViewChannel: false,});
        await raidTicketChannel.permissionOverwrites.edit(RAID_HELPER_ROLE_ID, {ViewChannel: false, });

        // Check if requester is an Admin before denying their access
        if (!isAdmin({ member: requester })) {
            await raidTicketChannel.permissionOverwrites.edit(requester, { ViewChannel: false });
        }
        // if they are admin, do nothing – their role perms handle access     

        // Grant ViewChannel for admin roles (if they exist)
        if (moderatorRole) {
            await raidTicketChannel.permissionOverwrites.edit(moderatorRole, { ViewChannel: true });
        }
        if (officerRole) {
            await raidTicketChannel.permissionOverwrites.edit(officerRole, { ViewChannel: true });
        }
        if (raidManagerRole) {
            await raidTicketChannel.permissionOverwrites.edit(raidManagerRole, { ViewChannel: true });
        }

        console.log(`Channel ${channelId} now restricted to admin roles.`);

        // --- Step 2: Send message to the now admin-only ticket channel with EXP Lair link and delete button ---
        const expLairMessageLink = sentExpLairMessage ? sentExpLairMessage.url : 'N/A (could not post to EXP Lair)';
        const requesterMember = await raidTicketChannel.guild.members.fetch(raidInfo.requesterId);

        const finalMessageEmbed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle('Raid Completed - Awaiting Admin Review')
            .setDescription(
                `This raid was completed by <@${completionInitiatorId}>!\n` +
                `Points have been awarded and the leaderboard updated. This channel is now only visible to staff.\n\n` +
                `**EXP Lair Post:** [**Click Here**](${expLairMessageLink})\n` +
                `**Requester:** <@${raidInfo.requesterId}>\n` +
                `**Original Task(s):** ${raidInfo.task}`
            )
            .setTimestamp()
            .setFooter({ text: 'Channel will be deleted by staff after review.' });

        const deleteButton = new ButtonBuilder()
            .setCustomId('deleteFinalizedRaidChannel') // Custom ID for the new button
            .setLabel('Delete Channel After Review')
            .setStyle(ButtonStyle.Danger); // Red button for deletion

        const actionRow = new ActionRowBuilder().addComponents(deleteButton);

        await raidTicketChannel.send({
            embeds: [finalMessageEmbed],
            components: [actionRow],
        });

        // --- Step 3: Update raid status in DB to reflect new state ---
        await updateRaid(channelId, {
            status: 'admin_review', // New status for admin review
            awaitingCompletionRequesterId: null, // Reset as completion is done
            expLairMessageLink: expLairMessageLink, // Store the link for admin reference
        });
        console.log(`Raid ${channelId} moved to 'admin_review' status.`);

    } catch (error) {
        console.error('Error processing raid finalization:', error);
        const raidTicketChannel = await client.channels.fetch(channelId);
        if (raidTicketChannel) {
            await raidTicketChannel.send('There was an error during final raid processing. Please contact staff.');
        }
        // Attempt to reset to active state if something went wrong but channel still exists
        await updateRaid(channelId, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null });
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
    const mismatchedTasks = new Set(); 
    const assignedUsers = new Set();

    // Determine the original tasks requested for this raid, including expanded meta-tasks
    const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split(/\s*[+,]\s*/).map(t => t.trim());
    const originalRaidEffectiveTasks = new Set(); 
    const originalRaidRequestedStrings = new Set(); 

    originalRequestedTasksRaw.forEach(task => {
        originalRaidRequestedStrings.add(task); // Store 'daily' or 'speaker'
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            // Expand meta-tasks like 'daily' into their components
            TASK_MAP_CATEGORIES[task].forEach(t => originalRaidEffectiveTasks.add(t));
        } else { // Assume direct task name if not a meta-category
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

        // Use the new utility function for point calculation
        const { originalTotalCalculatedPoints: pointsPerUserForTask, unknownTasks: calcUnknownTasks } = calculateTaskPointsWithMultiplier(taskName);
        if (calcUnknownTasks.length > 0) {
            calcUnknownTasks.forEach(t => unrecognizedTasks.add(t));
        }

        let totalPointsForUserAndTask = pointsPerUserForTask * multiplier;

        if (totalPointsForUserAndTask > 0) {
            const helperNames = Object.values(validUsers).join(', ');
            helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${totalPointsForUserAndTask} EXP each)`);
            usersForTask.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForUserAndTask;
                assignedUsers.add(userId); // Mark user as assigned for specific tasks
            });
        }
    }

    // --- Process global 'all' assignments for users not already specifically assigned ---
    const unassignedGlobalTaggedUsers = Array.from(globalTaggedUsers).filter(id => !assignedUsers.has(id));
    const validGlobalTaggedUsers = await filterAndGetValidUsers(new Set(unassignedGlobalTaggedUsers)); // Validate users

    if (Object.keys(validGlobalTaggedUsers).length > 0) {
        // Use the new utility function with the original raid task string to get base points for all tasks
        const { originalTotalCalculatedPoints: basePointsForAllTasks, unknownTasks: globalCalcUnknownTasks } = calculateTaskPointsWithMultiplier(raidInfo.task);
        if (globalCalcUnknownTasks.length > 0) {
            globalCalcUnknownTasks.forEach(t => unrecognizedTasks.add(t));
        }

        let totalPointsForGlobalHelpers = basePointsForAllTasks * globalMultiplier;

        const helperNames = Object.values(validGlobalTaggedUsers).join(', ');
        helperSummaries.push(`**All Tasks:** ${helperNames} (${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfo.task}${globalMultiplier > 1 ? ` x${globalMultiplier}` : ''})`);

        Object.keys(validGlobalTaggedUsers).forEach(userId => {
            pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
        });
    }

    // --- Final validation and warnings before completing the raid ---
    if (Object.keys(pointsAwarded).length === 0) {
        await updateRaid(message.channel.id, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null });
        await message.reply({
            content: 'No valid players were found or no points could be assigned based on your submission. Please use the `Close Raid` button to try again with correct formatting and valid users.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Apply MAX_XP_PER_RAID to each user's total points (this cap is per-user, not per-task string calculation)
    for (const userId in pointsAwarded) {
        pointsAwarded[userId] = Math.min(pointsAwarded[userId], MAX_XP_PER_RAID);
    }

    // Finalize the raid directly
    await finalizeRaid(
        message.client,
        message.channel.id,
        raidInfo,
        {
            pointsAwarded,
            helperSummaries,
            unrecognizedTasks,
            linesWithNoValidUsers,
            mismatchedTasks,
            attachmentUrl: attachment ? attachment.url : null
        },
        message.author.id
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
        await updateRaid(channelId, { status: 'active', awaitingCompletion: false, awaitingCompletionRequesterId: null });
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

        // Always try to fetch raid info. If it's a delete button, the channel might be in 'admin_review' status.
        const raidInfo = await getRaidInfo(interaction.channel.id);
        const isRaidTicketChannel = raidInfo && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;

        if (!isRaidTicketChannel) {
            // Only reply ephemerally if the customId matches our buttons/modals
            if (interaction.isButton() && (interaction.customId === 'closeRaidTicket' || interaction.customId === 'editTask_btn' || interaction.customId === 'deleteFinalizedRaidChannel')) {
                await interaction.reply({ content: 'This button can only be used in a raid ticket channel.', flags: MessageFlags.Ephemeral });
            } else if (interaction.isModalSubmit() && interaction.customId === 'editTaskModal') {
                await interaction.reply({ content: 'This action can only be performed in a raid ticket channel.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // If raidInfo was not found, it means this channel is not a recognized raid ticket or was already deleted.
        if (!raidInfo) {
            console.warn(`Raid info not found in DB/cache for channel ${interaction.channel.id}. Cannot process interaction.`);
            // Specifically handle the delete button here if raidInfo is missing, as the channel might be orphaned.
            if (interaction.isButton() && interaction.customId === 'deleteFinalizedRaidChannel') {
                await interaction.reply({ content: 'Could not retrieve raid details. This raid might have already been deleted, or its database entry is missing. Attempting to delete channel if it still exists.', flags: MessageFlags.Ephemeral });
                if (interaction.channel) {
                    try {
                        await interaction.channel.delete('Orphaned raid channel without DB entry, manually deleting.');
                    } catch (err) {
                        console.error(`Failed to delete orphaned channel ${interaction.channel.id}:`, err);
                    }
                }
            } else {
                await interaction.reply({ content: 'Could not retrieve raid details. This raid might have been completed or cancelled (channel deleted).', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Handle buttons
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'closeRaidTicket':
                    if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
                        return;
                    }
                    
                    await updateRaid(interaction.channel.id, {
                        status: 'awaiting_user_input',
                        awaitingCompletionRequesterId: interaction.user.id,
                    });

                    console.log(`Channel ${interaction.channel.id} now awaiting completion details from ${interaction.user.tag}.`);

                    await interaction.reply({
                        content:
                            'Mention those who helped e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 : @user1 @user2`'
                            + `\n* You can use \`All\` to refer to every requested task (e.g., \`all x2 = @user1 @user2\` for multiple runs)`
                            + `\n* Include a screenshot if possible.`
                            + `\n* You can type \`cancel\` to close the ticket without tagging helpers.`
                            + `\n* For multiple tasks, use \`task1 + task2 = @user\` or \`task1, task2 = @user\``
                            + `\n* For multiple runs of the same tasks, a multiplier can done \`task1xN = @user\` format.`,
                        flags: MessageFlags.Ephemeral
                    });
                    break;

                case 'editTask_btn':
                    if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
                        return;
                    }
                    const editTaskModal = getEditTaskModal(raidInfo.task);
                    await interaction.showModal(editTaskModal);
                    break;

                case 'deleteFinalizedRaidChannel': // Handler for the admin delete button
                    if (!await isStaff(interaction)) { // Only staff can delete this channel
                        return;
                    }

                    try {
                        // Retrieve the raid info one last time to ensure consistency, though it should be in `raidInfo` already
                        const raidToDeleteInfo = await getRaidInfo(interaction.channel.id);
                        if (raidToDeleteInfo) {
                            await deleteRaid(interaction.channel.id); // Delete from DB
                            await interaction.channel.delete('Admin manually deleted completed raid channel after review.'); // Delete the Discord channel
                        } else {
                            // If raidInfo somehow vanished between fetching and clicking delete, just delete the channel.
                            await interaction.channel.delete('Raid database entry missing, deleted channel anyway.');
                            await interaction.editReply({ content: `Raid channel <#${interaction.channel.id}> was deleted, but its database entry was already missing.`, ephemeral: true });
                        }
                    } catch (error) {
                        console.error(`Error deleting finalized raid channel ${interaction.channel.id}:`, error);
                        await interaction.editReply({ content: 'There was an error deleting the raid channel. Please check bot permissions or try again.', ephemeral: true });
                    }
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

                    // check if the input is valid or found in valid task list
                    const inputTasks = editedTasksInput.split(/\s*[+,]\s*/).map(t => t.trim());
                    const invalidTasks = inputTasks.filter(t => {
                        return !(ALLOWED_TASK_NAMES.includes(t) || TASK_MAP_CATEGORIES.hasOwnProperty(t));
                    });
                    if (invalidTasks.length > 0) {
                        await interaction.reply({ content: `The following tasks are not recognized: ${invalidTasks.map(t => `\`${t}\``).join(', ')}. Please use valid task names from \`!raidtasks\`.`, flags: MessageFlags.Ephemeral });
                        return;
                    }


                    // Updated to split tasks by '+' or ','
                    const newTasksArray = editedTasksInput.split(/\s*[+,]\s*/).map(t => t.trim());

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