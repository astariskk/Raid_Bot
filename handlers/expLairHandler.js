// handlers/expLairHandler.js
// This file is responsible for handling the completion and cancellation of raid threads,
// calculating and awarding EXP points to raid helpers, updating the leaderboard,
// and allowing the raid requester to edit raid tasks.

// Import necessary Discord.js components for UI elements and message types.
import { EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    ALLOWED_TASK_NAMES,
    MAX_XP_PER_RAID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    TASK_MAP_CATEGORIES
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

function extractUserIds(text) {
    return (text.match(/<@!?(\d+)>/g) || []).map(mention =>
        mention.replace(/<@!?(\d+)>/, '$1')
    );
}

/**
 * Parses the helper assignment message content to determine tasks, users, and multipliers.
 * @param {string} content The message content.
 * @returns {object} An object containing parsed assignment details.
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
 * Calculates the total EXP points for a given set of tasks.
 * @param {string[]} tasks An array of task names.
 * @returns {number} The total calculated points, capped at MAX_XP_PER_RAID.
 */
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

/**
 * Finalizes the raid completion process by posting summaries, awarding points, and locking the thread.
 * @param {import('discord.js').Message} message The message that triggered completion.
 * @param {object} raidInfo The raid's information.
 * @param {object} pointsAwarded A map of user IDs to points awarded.
 * @param {string[]} helperSummaries An array of strings summarizing helper contributions.
 * @param {Set<string>} unrecognizedTasks A set of task strings that were not recognized.
 * @param {Set<string>} linesWithNoValidUsers A set of lines that had no valid user mentions.
 * @param {Set<string>} mismatchedTasks A set of tasks submitted that were not in the original request.
 * @param {import('discord.js').Attachment} [attachment] An optional attachment from the completion message.
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
                const member = await message.guild.members.fetch(id);
                helperDisplayNames.push(member.displayName);
            } catch (err) {
                console.error(`Error fetching member ${id}:`, err);
                helperDisplayNames.push(`User-${id}`); // Fallback
            }
        }
        const helpersString = helperDisplayNames.length > 0 ? helperDisplayNames.join(', ') : 'None';

        const requesterMember = await message.guild.members.fetch(raidInfo.requesterId);

        // Construct and send embed to EXP Lair Channel
        const embed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle(`Raid Completion Report`)
            .setDescription(
                `**Raid requested by:** ${requesterMember}\n` +
                `**Task(s):** ${raidInfo.task}\n` +
                `**Helpers:** ${helpersString}`
            )
            .setTimestamp()
            .setFooter({ text: 'Raid Completion Details' });

        if (attachment) {
            embed.setImage(attachment.url);
        }

        const sentExpLairMessage = await expLairChannel.send({
            content: `Raid completed by ${message.member.displayName} from <#${originalRaidLogThread.id}>.`,
            embeds: [embed]
        });

        const expLairThread = await sentExpLairMessage.startThread({
            name: `COMPLETED Raid for ${requesterMember.displayName}`,
            autoArchiveDuration: 60
        });

        let expLairThreadContent = `This thread contains the full details for the raid.\n\n**Task Initially Requested:** ${raidInfo.task}\n**Points Breakdown:**\n`;

        if (Object.keys(pointsAwarded).length > 0) {
            for (const userId in pointsAwarded) {
                const member = await message.guild.members.fetch(userId);
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

        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }

        if (Object.keys(pointsAwarded).length > 0) {
            await sendLeaderboardBackup(message.client);
        }

        await message.reply(`Raid completed, This thread will now be locked.`);
        await deleteRaid(threadId); // Use new state management
        await originalRaidLogThread.setLocked(true);
    } catch (error) {
        console.error('Error processing raid completion:', error);
        await message.reply('There was an error processing the raid completion.');
    } finally {
        // Reset state using new state management
        await updateRaid(threadId, { awaitingCompletion: false, awaitingCompletionRequesterId: null });
    }
}

async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, globalMultiplier, unrecognizedTasks, linesWithNoValidUsers } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();

    const filterAndGetDisplayNames = async (userIds) => {
        const validUsers = {};
        for (const userId of userIds) {
            if (userId === message.author.id) {
                await message.channel.send(`Heads up! You (the requester) cannot award yourself points. Ignoring <@${userId}> for this submission.`);
                continue;
            }
            try {
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

    const pointsAwarded = {};
    const helperSummaries = [];
    const mismatchedTasks = new Set();
    const assignedUsers = new Set();

    const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
    const originalRaidEffectiveTasks = new Set();
    const originalRaidRequestedStrings = new Set();

    originalRequestedTasksRaw.forEach(task => {
        originalRaidRequestedStrings.add(task);
        if (TASK_MAP_CATEGORIES.hasOwnProperty(task)) {
            TASK_MAP_CATEGORIES[task].forEach(t => originalRaidEffectiveTasks.add(t));
        } else if (ALLOWED_TASK_NAMES.includes(task)) {
            originalRaidEffectiveTasks.add(task);
        }
    });

    for (const taskName in helperAssignments) {
        const { users, multiplier } = helperAssignments[taskName];
        const validUsers = await filterAndGetDisplayNames(users);
        const usersForTask = Object.keys(validUsers);

        if (usersForTask.length === 0) continue;

        let isValidAssignedTask = false;
        if (originalRaidRequestedStrings.has(taskName) || originalRaidEffectiveTasks.has(taskName)) {
            isValidAssignedTask = true;
        } else if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
            const metaCategoryTasks = TASK_MAP_CATEGORIES[taskName];
            if (metaCategoryTasks.every(metaTask => originalRaidEffectiveTasks.has(metaTask))) {
                isValidAssignedTask = true;
            }
        }

        if (!isValidAssignedTask) {
            mismatchedTasks.add(taskName + (multiplier > 1 ? `x${multiplier}` : ''));
            continue;
        }

        let pointsForThisTask = calculateTaskPoints([taskName]) * multiplier;

        if (pointsForThisTask > 0) {
            const helperNames = Object.values(validUsers).join(', ');
            helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${pointsForThisTask} EXP each)`);
            usersForTask.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + pointsForThisTask;
                assignedUsers.add(userId);
            });
        }
    }

    const unassignedGlobalTaggedUsers = Array.from(globalTaggedUsers).filter(id => !assignedUsers.has(id));
    const validGlobalTaggedUsers = await filterAndGetDisplayNames(new Set(unassignedGlobalTaggedUsers));
    if (Object.keys(validGlobalTaggedUsers).length > 0) {
        const tasksForGlobalHelpers = Array.from(originalRaidEffectiveTasks);
        let totalPointsForGlobalHelpers = calculateTaskPoints(tasksForGlobalHelpers) * globalMultiplier;

        const helperNames = Object.values(validGlobalTaggedUsers).join(', ');
        helperSummaries.push(`**All Helpers:** ${helperNames} Total ${totalPointsForGlobalHelpers} EXP each from tasks: (${raidInfo.task}${globalMultiplier > 1 ? `) x${globalMultiplier}` : ')'}`);
        Object.keys(validGlobalTaggedUsers).forEach(userId => {
            pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
        });
    }

    if (Object.keys(pointsAwarded).length === 0) {
        await message.reply({
            content: 'No valid players or tasks were detected. Please use the "Close Raid" button to try again.',
            flags: MessageFlags.Ephemeral
        });
        await updateRaid(message.channel.id, { awaitingCompletion: false, awaitingCompletionRequesterId: null });
        return;
    }

    if (mismatchedTasks.size > 0 || unrecognizedTasks.size > 0) {
        let warningMessage = '⚠️ **Warning:** Your submission contained the following issues:\n';
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            warningMessage += `- The task(s) ${unrecognizedList} were not recognized\n`;
        }
        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            warningMessage += `- The task(s) ${mismatchedList} were not part of the original raid request\n`;
        }
        warningMessage += 'Please use the `Close Raid` button to try again.';
        await message.reply({ content: warningMessage, flags: MessageFlags.Ephemeral });
        await updateRaid(message.channel.id, { awaitingCompletion: false, awaitingCompletionRequesterId: null });
        return;
    }

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
    await deleteRaid(threadId);
    await originalRaidLogThread.setLocked(true);
    await updateRaid(threadId, { awaitingCompletion: false, awaitingCompletionRequesterId: null });
}


export function setupExpLairHandlers(client) {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = await getRaidInfo(message.channel.id);

        if (!message.channel.isThread() || !raidInfo) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();

        if (raidInfo.awaitingCompletion) {
            if (message.author.id !== raidInfo.awaitingCompletionRequesterId) {
                return;
            }

            // Handle standard cancellation (more robust check)
            if (contentLower === 'cancel' && message.mentions.users.size === 0 && !message.attachments.first()) {
                await handleRaidCancellation(message, raidInfo);
                return;
            }

            await handleRaidCompletion(message, raidInfo);
            return;
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

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

        let raidInfo = await getRaidInfo(interaction.channel.id);

        if (!raidInfo) {
            console.warn(`Raid info not found in DB/cache for thread ${interaction.channel.id}. Cannot process interaction.`);
            await interaction.reply({ content: 'Could not retrieve raid details. This raid might have been completed or cancelled.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!await isAuthorizedToManageRaid(interaction, raidInfo)) {
            return;
        }

        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'closeRaidTicket':
                    await updateRaid(interaction.channel.id, {
                        awaitingCompletion: true,
                        awaitingCompletionRequesterId: interaction.user.id
                    });
                    console.log(`Thread ${interaction.channel.id} now awaiting completion details from ${interaction.user.tag}.`);

                    await interaction.reply({
                        content:
                            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 : @user1 @user2`'
                            + `\n* You can use \`All\` to refer to every requested task (e.g., \`all x2 = @user1 @user2\` for multiple runs)`
                            + `\n* Include a screenshot if possible.`
                            + `\n* You can type \`cancel\` to close the thread without tagging helpers.`
                            + `\n* For multiple tasks, use \`task1 + task2 = @user\``
                            + `\n* For multiple runs of the same tasks, a multiplier can done  \`task1xN = @user\` format.`,
                        flags: MessageFlags.Ephemeral
                    });
                    break;

                case 'editTask_btn':
                    const editTaskModal = getEditTaskModal(raidInfo.task);
                    await interaction.showModal(editTaskModal);
                    break;
                default:
                    break;
            }
        }

        if (interaction.isModalSubmit()) {
            switch (interaction.customId) {
                case 'editTaskModal':
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
                    
                    await updateRaidLogEmbed(
                        client,
                        interaction.channel.id,
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
