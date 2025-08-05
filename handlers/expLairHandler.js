// handlers/expLairHandler.js
// This file is responsible for handling the completion and cancellation of raid threads,
// calculating and awarding EXP points to raid helpers, updating the leaderboard,
// and allowing the raid requester to edit raid tasks.

// Import necessary Discord.js components for UI elements and message types.
import { EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    ALLOWED_TASK_NAMES,
    GENERIC_TASKS_LIST,
    OTHERS_FOUR_LIST,
    OTHERS_SEVEN_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    MAX_XP_PER_RAID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    TASK_MAP_CATEGORIES
} from '../config/constants.js';
import { updateLeaderboard } from './leaderboardCore.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsHandler.js';
import { activeRaidThreads, updateRaidStatus, getEditTaskModal, updateRaidLogEmbed } from '../activeRaidState.js';
import { sendLeaderboardBackup } from './backupHandler.js'; // Import the backup function

// --- Constants for Embed Colors ---
const COLOR_SUCCESS = 0x57F287; // Green
const COLOR_CANCELLED = 0xFF4500; // Red
const COLOR_INFO = 0x0099ff; // Blue

/**
 * Checks if a member has an admin/moderator role.
 * @param {object} source - The source object, either a Discord message or interaction.
 * @returns {boolean}
 */
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

/**
 * Checks if the user is authorized to manage the raid (either the requester or an admin).
 * @param {import('discord.js').Interaction} interaction - The interaction object.
 * @param {object} raidInfo - The raid information object.
 * @returns {Promise<boolean>}
 */
async function isAuthorizedToManageRaid(interaction, raidInfo) {
    // A staff member or the original requester can manage the raid.
    if (interaction.user.id === raidInfo.requesterId || isAdmin(interaction)) {
        return true;
    }
    await interaction.reply({
        content: 'Only the user who initiated this raid or a staff member can perform this action.',
        flags: MessageFlags.Ephemeral
    });
    return false;
}

/**
 * Extracts user IDs from a string containing user mentions.
 * @param {string} text - The message content.
 * @returns {string[]}
 */
function extractUserIds(text) {
    return (text.match(/<@!?(\d+)>/g) || []).map(mention =>
        mention.replace(/<@!?(\d+)>/, '$1')
    );
}

/**
 * Parses the message content to identify helper assignments for tasks, including multipliers.
 * Handles 'task = @user', 'taskxN = @user', and 'all = @user' assignments.
 *
 * @param {string} content - The message content.
 * @returns {{helperAssignments: {[taskName: string]: {users: Set<string>, multiplier: number}}, globalTaggedUsers: Set<string>, globalMultiplier: number, hasValidTags: boolean, unrecognizedTasks: Set<string>, linesWithNoValidUsers: Set<string>}}
 */
function parseHelperAssignments(content) {
    const helperAssignments = {}; // Stores { 'taskName': { users: Set<string>, multiplier: number } }
    const globalTaggedUsers = new Set();
    let globalMultiplier = 1;
    let hasValidTags = false;
    const unrecognizedTasks = new Set(); // For tasks that are not in ALLOWED_TASK_NAMES or malformed task strings
    const linesWithNoValidUsers = new Set(); // For lines where no actual users were tagged

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

/**
 * Calculates the total points for a given list of tasks.
 * @param {string[]} tasks - An array of task names.
 * @returns {number}
 */
function calculateTaskPoints(tasks) {
    let uniqueEffectiveTasks = new Set();

    tasks.forEach(task => {
        // No special handling for custom tasks; if they're not in POINTS_CONFIG, they give 0 points.
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            TASK_MAP_CATEGORIES[task].forEach(t => uniqueEffectiveTasks.add(t));
        } else if (POINTS_CONFIG[task]) {
            uniqueEffectiveTasks.add(task);
        }
    });

    let totalPoints = 0;
    uniqueEffectiveTasks.forEach(taskName => {
        totalPoints += (POINTS_CONFIG[taskName] || 0); // Custom/unrecognized tasks will be 0 here.
    });

    // Ensure total points do not exceed MAX_XP_PER_RAID
    return Math.min(totalPoints, MAX_XP_PER_RAID);
}

/**
 * Common logic to finalize raid completion after confirmation or a valid submission.
 * This function will be called from both the original `handleRaidCompletion` and the new confirmation handler.
 * @param {import('discord.js').Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 * @param {{[userId: string]: number}} pointsAwarded - The points awarded to each user.
 * @param {string[]} helperSummaries - An array of summary strings for each helper.
 * @param {Set<string>} unrecognizedTasks - A set of unrecognized task names.
 * @param {Set<string>} linesWithNoValidUsers - A set of lines with no valid user tags.
 * @param {Set<string>} mismatchedTasks - A set of tasks that did not match the original raid.
 * @param {import('discord.js').Attachment|null} attachment - The optional attachment.
 */
async function finalizeRaidCompletion(message, raidInfo, pointsAwarded, helperSummaries, unrecognizedTasks, linesWithNoValidUsers, mismatchedTasks, attachment) {
    const originalRaidLogThread = message.channel;
    const threadId = originalRaidLogThread.id;

    await updateRaidStatus(message.client, threadId, '✅ Done', COLOR_SUCCESS);

    try {
        const expLairChannel = await message.client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel.');
            await message.reply('Could not find the EXP Lair channel to post the completion details.');
            return;
        }

        // Fetch display names for all helpers to avoid pings.
        const helperDisplayNames = [];
        const allHelperIds = Object.keys(pointsAwarded);
        for (const id of allHelperIds) {
            try {
                // Fetch the guild member to get the server nickname
                const member = await message.guild.members.fetch(id);
                helperDisplayNames.push(member.displayName);
            } catch (err) {
                console.error(`Error fetching member ${id}:`, err);
                helperDisplayNames.push(`User-${id}`); // Fallback
            }
        }
        const helpersString = helperDisplayNames.length > 0 ? helperDisplayNames.join(', ') : 'None';

        // Construct and send embed to EXP Lair Channel, using mentions
        const requesterMember = await message.guild.members.fetch(raidInfo.requesterId);
        const embed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle(`Raid Completed by ${message.author}`) // Use message.author to get a mention
            .setDescription(`Raid requested by: ${requesterMember}\nTask(s): ${raidInfo.task}\nHelpers: ${helpersString}`) // Use requesterMember to get a mention
            .setTimestamp()
            .setFooter({ text: 'Raid Completion Report' });

        if (attachment) {
            embed.setImage(attachment.url);
        }

        const sentExpLairMessage = await expLairChannel.send({
            embeds: [embed]
        });

        const expLairThread = await sentExpLairMessage.startThread({
            name: `COMPLETED Raid for ${message.member.displayName}`,
            autoArchiveDuration: 60
        });

        // The thread message should use regular display names, not mentions
        let expLairThreadContent = `This thread contains the full details for the completed raid by ${message.member.displayName} from <#${originalRaidLogThread.id}>.

**Task Initially Requested:** ${raidInfo.task}
**Points Breakdown:**
`;

        if (Object.keys(pointsAwarded).length > 0) {
            for (const userId in pointsAwarded) {
                // Use the guild member's display name for the points breakdown
                const member = await message.guild.members.fetch(userId);
                expLairThreadContent += `${member.displayName}: ${pointsAwarded[userId]} EXP\n`;
            }
        } else {
            expLairThreadContent += `No standard EXP awarded based on submission.`;
        }

        expLairThreadContent += `\n**Helper Assignments Breakdown:** \n${helperSummaries.join('\n')}\n`;

        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`**Note**: The following tasks were not recognized and earned no points: ${unrecognizedList}. Use valid task names from \`!raidtasks\`.\n`);
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
            await sendLeaderboardBackup(message.client);
        }

        delete activeRaidThreads[threadId];
        await originalRaidLogThread.setLocked(true);
    } catch (error) {
        console.error('Error processing raid completion:', error);
        await message.reply('There was an error processing the raid completion.');
    } finally {
        // Reset state
        raidInfo.awaitingCompletion = false;
        raidInfo.awaitingCompletionRequesterId = null;
    }
}


/**
 * Handles the completion of a raid thread.
 * @param {import('discord.js').Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, globalMultiplier, hasValidTags, unrecognizedTasks, linesWithNoValidUsers } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();
    const originalRaidLogThread = message.channel;

    /**
     * Filters out invalid user IDs (self-tags and bot tags) and returns display names.
     * @param {Set<string>} userIds - A set of user IDs to validate.
     * @returns {Promise<{[userId: string]: string}>} A map of valid user IDs to their display names.
     */
    const filterAndGetDisplayNames = async (userIds) => {
        const validUsers = {};
        for (const userId of userIds) {
            if (userId === message.author.id) {
                await message.channel.send(`Heads up! You (the requester) cannot award yourself points. Ignoring <@${userId}> for this submission.`);
                continue;
            }
            try {
                // Fetch the guild member to get the server nickname (displayName)
                const member = await message.guild.members.fetch(userId);
                if (member.user.bot) {
                    await message.channel.send(`Heads up! Bots cannot be awarded points. Ignoring <@${userId}> for this submission.`);
                    continue;
                }
                validUsers[userId] = member.displayName;
            } catch (error) {
                console.error(`Could not fetch guild member ${userId} during validation:`, error);
                await message.channel.send(`Warning: Could not verify user <@${userId}>. Skipping them for points.`);
            }
        }
        return validUsers;
    };


    const pointsAwarded = {}; // Stores total points per user
    const helperSummaries = [];
    const mismatchedTasks = new Set(); // Tasks mentioned in completion but not in original request
    const assignedUsers = new Set(); // Keep track of users explicitly assigned to a task

    // 1. Determine all effective tasks AND raw requested strings from the ORIGINAL raid request
    const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
    const originalRaidEffectiveTasks = new Set(); // Contains all individual tasks that were part of the original request (expanded meta-tasks)
    const originalRaidRequestedStrings = new Set(); // Contains the raw strings from the original request (e.g., 'daily', 'ezrajal')

    originalRequestedTasksRaw.forEach(task => {
        originalRaidRequestedStrings.add(task);
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            TASK_MAP_CATEGORIES[task].forEach(t => originalRaidEffectiveTasks.add(t));
        } else if (ALLOWED_TASK_NAMES.includes(task)) {
            originalRaidEffectiveTasks.add(task);
        }
    });

    // 2. Calculate points for specifically assigned helpers, validating against original raid tasks
    for (const taskName in helperAssignments) {
        const { users, multiplier } = helperAssignments[taskName];
        const validUsers = await filterAndGetDisplayNames(users);
        const usersForTask = Object.keys(validUsers);

        if (usersForTask.length === 0) continue;

        let isValidAssignedTask = false;

        // Case 1: The assigned task name is directly in the original requested strings
        if (originalRaidRequestedStrings.has(taskName)) {
            isValidAssignedTask = true;
        }
        // Case 2: The assigned task name is an individual task that was part of an expanded meta-task
        else if (originalRaidEffectiveTasks.has(taskName)) {
            isValidAssignedTask = true;
        }
        // Case 3: The assigned task name is a meta-category
        else if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
            const metaCategoryTasks = TASK_MAP_CATEGORIES[taskName];
            const allMetaTasksPresent = metaCategoryTasks.every(metaTask => originalRaidEffectiveTasks.has(metaTask));
            if (allMetaTasksPresent) {
                isValidAssignedTask = true;
            }
        }

        if (!isValidAssignedTask) {
            mismatchedTasks.add(taskName + (multiplier > 1 ? `x${multiplier}` : ''));
            continue;
        }

        let pointsForThisTask = calculateTaskPoints([taskName]);
        pointsForThisTask *= multiplier;

        if (pointsForThisTask > 0) {
            const helperNames = Object.values(validUsers).join(', ');
            helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${pointsForThisTask} EXP each)`);

            usersForTask.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + pointsForThisTask;
                assignedUsers.add(userId);
            });
        }
    }

    // 3. Calculate points for 'all' tagged helpers, but only for those not already assigned.
    const unassignedGlobalTaggedUsers = Array.from(globalTaggedUsers).filter(id => !assignedUsers.has(id));
    const validGlobalTaggedUsers = await filterAndGetDisplayNames(new Set(unassignedGlobalTaggedUsers));
    if (Object.keys(validGlobalTaggedUsers).length > 0) {
        const tasksForGlobalHelpers = Array.from(originalRaidEffectiveTasks);
        let totalPointsForGlobalHelpers = calculateTaskPoints(tasksForGlobalHelpers);
        totalPointsForGlobalHelpers *= globalMultiplier; // Apply global multiplier

        const helperNames = Object.values(validGlobalTaggedUsers).join(', ');
        helperSummaries.push(
            `**All Helpers:** ${helperNames} Total ${totalPointsForGlobalHelpers} EXP each from tasks: (${raidInfo.task}${globalMultiplier > 1 ? `) x${globalMultiplier}` : ')'}`
        );
        Object.keys(validGlobalTaggedUsers).forEach(userId => {
            pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
        });
    }

    // FIX: A submission is only valid if points are awarded. An attachment alone is not enough.
    if (Object.keys(pointsAwarded).length === 0) {
        await message.reply({
            content: 'No valid players or tasks were detected. Press the close raid button again and tag your helpers or type `cancel` to close this raid.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }


    // If there are mismatched tasks or unrecognized tasks, send a warning
    if (mismatchedTasks.size > 0 || unrecognizedTasks.size > 0) {
        let warningMessage = '⚠️ **Warning:** Your submission contained the following issues:\n';
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            warningMessage += `- The task(s) ${unrecognizedList} were not recognized and will not earn points.\n`;
        }
        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            warningMessage += `- The task(s) ${mismatchedList} were not part of the original raid request and will not earn points.\n`;
        }
        await message.reply({ content: warningMessage, flags: MessageFlags.Ephemeral });
    }


    // Finalize the completion
    // Apply MAX_XP_PER_RAID limit to each user's total points awarded in this completion
    for (const userId in pointsAwarded) {
        pointsAwarded[userId] = Math.min(pointsAwarded[userId], MAX_XP_PER_RAID);
    }
    await finalizeRaidCompletion(message, raidInfo, pointsAwarded, helperSummaries, unrecognizedTasks, linesWithNoValidUsers, mismatchedTasks, attachment);
}


async function handleRaidCancellation(message, raidInfo) {
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    await message.reply('Raid thread closed without helpers/screenshot. Thread Locked.');
    await updateRaidStatus(message.client, threadId, '❌ Cancelled', COLOR_CANCELLED);
    delete activeRaidThreads[threadId];
    await originalRaidLogThread.setLocked(true);

    raidInfo.awaitingCompletion = false;
    raidInfo.awaitingCompletionRequesterId = null;
}


export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion/cancellation messages in raid threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = activeRaidThreads[message.channel.id];

        // Ensure it's a thread and we have active raid info for it.
        if (
            !message.channel.isThread() ||
            !raidInfo
        ) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();

        // Check if we are waiting for a completion from a specific user
        if (raidInfo.awaitingCompletion) {
            if (message.author.id !== raidInfo.awaitingCompletionRequesterId) {
                return;
            }

            // Handle standard cancellation
            if (contentLower === 'cancel' && message.mentions.users.size === 0 && !message.attachments.first()) {
                await handleRaidCancellation(message, raidInfo);
                return;
            }

            // If we've reached here, it's a new attempt to tag/close the raid
            await handleRaidCompletion(message, raidInfo);
            return;
        }
    });

    // --- Interaction Create Listener (for closeRaidTicket and editTask_btn buttons and modals) ---
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        // Check if interaction is in a thread and reply ephemeral if not
        if (!interaction.channel.isThread()) {
            if (interaction.isButton() && (interaction.customId === 'closeRaidTicket' || interaction.customId === 'editTask_btn')) {
                await interaction.reply({ content: 'This button can only be used in a raid thread.', flags: MessageFlags.Ephemeral });
                return;
            }
            if (interaction.isModalSubmit() && interaction.customId === 'editTaskModal') {
                await interaction.reply({ content: 'This action can only be performed in a raid thread.', flags: MessageFlags.Ephemeral });
                return;
            }
            return;
        }

        let raidInfo = activeRaidThreads[interaction.channel.id];

        if (!raidInfo) {
            console.warn(`Raid info not found in activeRaidThreads for thread ${interaction.channel.id}. Attempting to reconstruct.`);
            try {
                const parentChannel = await interaction.client.channels.fetch(interaction.channel.parentId);
                if (!parentChannel) {
                    console.error(`Parent channel ${interaction.channel.parentId} not found or inaccessible for thread ${interaction.channel.id}. Cannot reconstruct raidInfo.`);
                    await interaction.reply({ content: 'Could not find the original channel for this raid. Please try again or create a new raid.', flags: MessageFlags.Ephemeral });
                    return;
                }
                const originalMessageInParent = await parentChannel.messages.fetch(interaction.channel.id);

                if (originalMessageInParent && originalMessageInParent.embeds.length > 0) {
                    const originalEmbed = originalMessageInParent.embeds[0];
                    const taskField = originalEmbed.fields.find(field => field.name === 'Task(s)');
                    const requesterField = originalEmbed.fields.find(field => field.name === 'Requested By');
                    const mapField = originalEmbed.fields.find(field => field.name === 'Map Name');
                    const serverField = originalEmbed.fields.find(field => field.name === 'Server');
                    const descriptionField = originalEmbed.fields.find(field => field.name === 'Description');

                    raidInfo = {
                        messageId: originalMessageInParent.id,
                        originalChannelId: interaction.channel.parentId,
                        task: taskField ? taskField.value : 'unknown',
                        requesterId: requesterField ? requesterField.value.replace(/<@!?(\d+)>/, '$1') : interaction.user.id,
                        mapName: mapField ? mapField.value : 'N/A',
                        server: serverField ? serverField.value : 'N/A',
                        description: descriptionField ? descriptionField.value : 'No description provided.',
                        awaitingCompletion: false,
                        awaitingCompletionRequesterId: null, // Initialize this new property
                    };
                    activeRaidThreads[interaction.channel.id] = raidInfo;
                    console.log(`Reconstructed raidInfo for thread ${interaction.channel.id}:`, raidInfo);
                } else {
                    console.error(`Could not find parent message or embed to reconstruct raidInfo for thread ${interaction.channel.id}`);
                    await interaction.reply({ content: 'Could not retrieve raid details. Please try again or create a new raid.', flags: MessageFlags.Ephemeral });
                    return;
                }
            } catch (error) {
                console.error(`Error reconstructing raidInfo for thread ${interaction.channel.id}:`, error);
                await interaction.reply({ content: 'There was an error retrieving raid details. Please try again or create a new raid.', flags: MessageFlags.Ephemeral });
                return;
            }
        }

        // Use the new helper function for authorization check
        if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
            return;
        }

        // --- Handle Button Interactions ---
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'closeRaidTicket':
                    raidInfo.awaitingCompletion = true;
                    // Store the ID of the user who pressed the button to expect their next message
                    raidInfo.awaitingCompletionRequesterId = interaction.user.id;
                    console.log(`Thread ${interaction.channel.id} now awaiting completion details from ${interaction.user.tag}.`);

                    await interaction.reply({
                        content:
                            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 : @user1 @user2`'
                            + `\n* You can use \`All\` to refer to every requested task (e.g., \`all x2 = @user1 @user2\` for multiple runs)`
                            + `\n* Include a screenshot if possible.`
                            + `\n* You can type \`cancel\` to close the thread without tagging helpers.`
                            + `\n* For multiple tasks, use \`task1 + task2 = @user\``
                            + `\n* For multiple runs of the same tasks, a multiplier can done  \`task1xN = @user\` format.`,
                        flags: MessageFlags.Ephemeral
                    });
                    break;

                case 'editTask_btn':
                    const editTaskModal = getEditTaskModal(raidInfo.task);
                    await interaction.showModal(editTaskModal);
                    break;

                default:
                    console.log(`Unhandled button interaction customId: ${interaction.customId}`);
                    break;
            }
        }

        // --- Handle Modal Submissions ---
        if (interaction.isModalSubmit()) {
            switch (interaction.customId) {
                case 'editTaskModal':
                    const editedTasksInput = interaction.fields.getTextInputValue('editedTaskInput').toLowerCase();
                    const newTasksArray = editedTasksInput.split(/\s*\+\s*/).map(t => t.trim());

                    // Validate new tasks, excluding custom tasks.
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

                    // Update the raidInfo task string directly (replace, not append)
                    raidInfo.task = newTasksArray.join(' + ');

                    // Update the original embed in the raid logs channel using sharedState's function
                    await updateRaidLogEmbed(
                        client,
                        interaction.channel.id,
                        {
                            title: `New Raid Request: ${raidInfo.task}`, // Update embed title
                            fields: [
                                { name: 'Task(s)', value: raidInfo.task, inline: true } // Update task field
                            ]
                        }
                    );

                    await interaction.reply({ content: `Successfully updated raid tasks to "${editedTasksInput}"!`, flags: MessageFlags.Ephemeral });
                    break;

                default:
                    console.log(`Unhandled modal submission customId: ${interaction.customId}`);
                    break;
            }
        }
    });
}
