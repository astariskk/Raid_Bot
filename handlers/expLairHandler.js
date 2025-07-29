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
    GENERIC_TASKS_LIST, // Not used in this file, but kept for consistency if needed elsewhere
    OTHERS_LIST, // Not used in this file, but kept for consistency if needed elsewhere
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

function extractUserIds(text) {
    return (text.match(/<@!?(\d+)>/g) || []).map(mention =>
        mention.replace(/<@!?(\d+)>/, '$1')
    );
}

/**
 * Parses the message content to identify helper assignments for tasks, including multipliers.
 * Handles 'task = @user', 'taskxN = @user', and 'all = @user' assignments.
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

                if (ALLOWED_TASK_NAMES.includes(taskName)) {
                    if (!helperAssignments[taskName]) {
                        helperAssignments[taskName] = { users: new Set(), multiplier: taskMultiplier };
                    }
                    helperAssignments[taskName].users.add(userId);
                    helperAssignments[taskName].multiplier = taskMultiplier;

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
        // No special handling for custom tasks; if they're not in POINTS_CONFIG, they give 0 points.
        if (task === 'daily' || task === 'dailies') {
            DAILIES_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        } else if (task === 'weekly' || task === 'weeklies') {
            WEEKLIES_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        } else if (task === 'templeshrine') {
            TEMPLESHRINE_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        } else if (task === 'originul') {
            ORIGINUL_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        }
        else if (POINTS_CONFIG[task]) {
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
 * Handles the completion of a raid thread.
 * @param {import('discord.js').Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, globalMultiplier, hasValidTags, unrecognizedTasks, linesWithNoValidUsers } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    // Filter out self-tags and bot tags
    const filterValidUsers = async (userIds) => {
        const validUserIds = new Set();
        for (const userId of userIds) {
            if (userId === message.author.id) {
                await message.channel.send(`Heads up! You (the requester) cannot award yourself points. Ignoring <@${userId}> for this submission.`);
                continue;
            }
            try {
                const user = await message.client.users.fetch(userId, { force: true });
                // keep comment for future testing
                /* if (user.bot) {      
                    await message.channel.send(`Heads up! Bots cannot be awarded points. Ignoring <@${userId}> for this submission.`);
                    continue;
                } */
                validUserIds.add(userId);
            } catch (error) {
                console.error(`Could not fetch user ${userId} during validation:`, error);
                await message.channel.send(`Warning: Could not verify user <@${userId}>. Skipping them for points.`);
            }
        }
        return validUserIds;
    };

    // If no valid tags and no screenshot, prompt for input
    if (!hasValidTags && !attachment) { // Removed customTasksDetected check
        await message.reply(
            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 = @user1 @user2`'
            + `\n* You can use \`All\` to refer to every requested task (e.g., \`all x2 = @user1 @user2\` for multiple runs)` // Updated for xN on all
            + `\n* Include a screenshot if possible.`
            + `\n* You can type \`cancel\` to close the thread without tagging helpers.`
            + `\n* For multiple tasks, use \`task1 + task2 = @user\``
            + `\n* For multiple runs of the same tasks, a multiplier can done  \`task1xN = @user\` format.`
        );
        raidInfo.awaitingCompletionRequesterId = null; 
        return;
    }

    await updateRaidStatus(message.client, threadId, '✅ Done', COLOR_SUCCESS);

    try {
        const expLairChannel = await message.client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel.');
            await message.reply('Could not find the EXP Lair channel to post the completion details.');
            // raidInfo.awaitingCompletion = false; // Moved to finally block
            // Also reset awaitingCompletionRequesterId on error.
            raidInfo.awaitingCompletionRequesterId = null;
            return;
        }

        const pointsAwarded = {}; // Stores total points per user
        const helperSummaries = [];
        const mismatchedTasks = new Set(); // Tasks mentioned in completion but not in original request
        // Removed customTasksInCompletion

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

        // 2. Calculate points for 'all' tagged helpers
        const validGlobalTaggedUsers = await filterValidUsers(globalTaggedUsers);
        if (validGlobalTaggedUsers.size > 0) {
            const tasksForGlobalHelpers = Array.from(originalRaidEffectiveTasks);
            let totalPointsForGlobalHelpers = calculateTaskPoints(tasksForGlobalHelpers);
            totalPointsForGlobalHelpers *= globalMultiplier; // Apply global multiplier

            const helperNames = Array.from(validGlobalTaggedUsers).map(id => `<@${id}>`).join(', ');
            helperSummaries.push(
                `**All Helpers:** ${helperNames} Total ${totalPointsForGlobalHelpers} EXP each from tasks: (${raidInfo.task}${globalMultiplier > 1 ? `) x${globalMultiplier}` : ')'}`
            );
            validGlobalTaggedUsers.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
            });
        }

        // 3. Calculate points for specifically assigned helpers, validating against original raid tasks
        for (const taskName in helperAssignments) {
            const { users, multiplier } = helperAssignments[taskName];
            const usersForTask = await filterValidUsers(users);
            if (usersForTask.size === 0) continue;

            let isValidAssignedTask = false;

            // Case 1: The assigned task name is directly in the original requested strings (e.g., 'daily' was requested, and 'daily' is tagged)
            if (originalRaidRequestedStrings.has(taskName)) {
                isValidAssignedTask = true;
            }
            // Case 2: The assigned task name is an individual task that was part of an expanded meta-task in the original request
            // (e.g., original was 'daily', effective tasks include 'ezrajal', and 'ezrajal' is tagged)
            else if (originalRaidEffectiveTasks.has(taskName)) {
                isValidAssignedTask = true;
            }
            // Case 3: The assigned task name is a meta-category (e.g., 'daily')
            // AND all its constituent tasks were effectively covered by the original request.
            else if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
                const metaCategoryTasks = TASK_MAP_CATEGORIES[taskName];
                // Check if ALL tasks within this meta-category are present in the original effective tasks
                const allMetaTasksPresent = metaCategoryTasks.every(metaTask => originalRaidEffectiveTasks.has(metaTask));
                if (allMetaTasksPresent) {
                    isValidAssignedTask = true;
                }
            }


            if (!isValidAssignedTask) {
                mismatchedTasks.add(taskName + (multiplier > 1 ? `x${multiplier}` : ''));
                continue;
            }

            let pointsForThisTask = calculateTaskPoints([taskName]); // Custom tasks will yield 0 points here
            pointsForThisTask *= multiplier;

            if (pointsForThisTask > 0) {
                const helperNames = Array.from(usersForTask).map(id => `<@${id}>`).join(', ');
                helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${pointsForThisTask} EXP each)`);

                usersForTask.forEach(userId => {
                    pointsAwarded[userId] = (pointsAwarded[userId] || 0) + pointsForThisTask;
                });
            }
        }

        // Updated condition to not check for customTasksInCompletion
        if (Object.keys(pointsAwarded).length === 0 && !hasValidTags) {
            await message.reply('No valid helpers or tasks specified, or specified tasks were not part of the original request. Please tag helpers with tasks that were part of the raid, or type "cancel" to close without helpers.');
            raidInfo.awaitingCompletionRequesterId = null;
            return;
        }

        // Apply MAX_XP_PER_RAID limit to each user's total points awarded in this completion
        for (const userId in pointsAwarded) {
            pointsAwarded[userId] = Math.min(pointsAwarded[userId], MAX_XP_PER_RAID);
        }

        // Construct and send embed to EXP Lair Channel
        const allHelperIds = Object.keys(pointsAwarded);
        const helpersString = allHelperIds.length > 0 ? allHelperIds.map(id => `<@${id}>`).join(' ') : 'None';

        const embed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle(`Raid Completed by ${message.author.username}`) 
            .setDescription(`Raid requested by: <@${raidInfo.requesterId}>\nTask(s): ${raidInfo.task}\nHelpers: ${helpersString}`)
            .setTimestamp() 
            .setFooter({ text: 'Raid Completion Report' });

        if (attachment) {
            embed.setImage(attachment.url);
        }

        // Send the main embed to EXP Lair Channel first
        const sentExpLairMessage = await expLairChannel.send({
            embeds: [embed]
        });

        // Create and send details to a new thread from the *sent message* in EXP Lair
        const expLairThread = await sentExpLairMessage.startThread({
            name: `COMPLETED-${raidInfo.task}- Raid for ${message.author.username}`,
            autoArchiveDuration: 60
        });

        // Construct the content for the *new thread*
        let expLairThreadContent = `This thread contains the full details for the completed raid by <@${raidInfo.requesterId}> from <#${originalRaidLogThread.id}>.

**Task Initially Requested:** ${raidInfo.task}
**Points Breakdown:**
`;

        if (Object.keys(pointsAwarded).length > 0) {
            for (const userId in pointsAwarded) {
                expLairThreadContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
            }
        } else {
            expLairThreadContent += `No standard EXP awarded based on submission.`;
        }


        expLairThreadContent += `\n**Helper Assignments Breakdown:** \n${helperSummaries.join('\n')}\n`;

        // Provide feedback for unrecognized tasks (parsed but not in ALLOWED_TASK_NAMES)
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`**Note**: The following tasks were not recognized and earned no points: ${unrecognizedList}. Use valid task names from \`!raidtasks\`.\n`);
        }

        // Provide feedback for lines where no valid users were tagged
        if (linesWithNoValidUsers.size > 0) {
            const invalidUserLinesList = Array.from(linesWithNoValidUsers).map(line => `\`${line}\``).join('\n');
            expLairThreadContent += (`\n**Warning**: The following lines were ignored because no valid users were tagged (e.g., only roles were mentioned, or no one was tagged):\n${invalidUserLinesList}\n`);
        }

        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`\n**Warning**: These tasks weren't part of the original raid (**${raidInfo.task}**) and earned no points: ${mismatchedList}.`);
        }

        // Send the detailed content to the new thread
        await expLairThread.send({ content: expLairThreadContent });

        // Update leaderboard (moved after sending messages for better flow, but can be done earlier)
        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }

        // Trigger a leaderboard backup after points are successfully awarded and leaderboard updated
        if (Object.keys(pointsAwarded).length > 0) { 
            await sendLeaderboardBackup(message.client);
        }

        // Clean up and delete original raid thread
        delete activeRaidThreads[threadId];
        await originalRaidLogThread.setLocked(true); 
    } catch (error) {
        console.error('Error processing raid completion:', error);
        await message.reply('There was an error processing the raid completion.');
    } finally {
        // Always reset state after processing completion attempt, regardless of success or failure
        raidInfo.awaitingCompletion = false; 
        raidInfo.awaitingCompletionRequesterId = null; // Clear the ID
    }
}


async function handleRaidCancellation(message, raidInfo) {
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    await message.reply('Raid thread closed without helpers/screenshot. Thread deleted.'); // Changed message
    await updateRaidStatus(message.client, threadId, '❌ Cancelled', COLOR_CANCELLED);
    delete activeRaidThreads[threadId];
    await originalRaidLogThread.setLocked(true);
    
    // Reset awaitingCompletion state and ID upon successful cancellation
    raidInfo.awaitingCompletion = false;
    raidInfo.awaitingCompletionRequesterId = null;
}



export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion/cancellation messages in raid threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = activeRaidThreads[message.channel.id];

        // Ensure it's a thread and we have active raid info for it.
        // The message must be from the requester OR an admin/mod/raid manager for general interaction.
        if (
            !message.channel.isThread() ||
            !raidInfo ||
            (message.author.id !== raidInfo.requesterId && !isAdmin(message))
        ) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();
        const attachment = message.attachments.first();

        // If awaiting completion, ONLY process messages from the specific user who initiated the completion flow.
        if (raidInfo.awaitingCompletion) {
            if (message.author.id !== raidInfo.awaitingCompletionRequesterId) {
                // await message.reply({ content: 'Waiting for input from the raid requester to finalize completion.', flags: MessageFlags.Ephemeral });
                return; 
            }

            // Handle cancellation - only if awaiting completion confirmation from the specific user
            if (contentLower === 'cancel' && message.mentions.users.size === 0 && !attachment) {
                await handleRaidCancellation(message, raidInfo);
                return;
            }

            // Handle raid completion - only if awaiting completion confirmation from the specific user
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
                        awaitingCompletionRequesterId: null // Initialize this new property
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
                        if (!ALLOWED_TASK_NAMES.includes(taskName)) { // Removed custom prefix check
                            await interaction.reply({ // Changed from editReply to reply
                                content: `Invalid task "${taskName}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                                embeds: [getCombinedTasksAndPointsEmbed()],
                                flags: MessageFlags.Ephemeral
                            });
                            return;
                        }
                    }

                    // Update the raidInfo task string directly (replace, not append)
                    raidInfo.task = newTasksArray.join(' + ');

                    // Update the thread name to reflect edited tasks
                    const newThreadName = `${raidInfo.task} | ${raidInfo.mapName} | ${raidInfo.server} | ${interaction.user.username}`;
                    await interaction.channel.setName(newThreadName);

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

                    await interaction.reply({ content: `Successfully updated raid tasks to "${editedTasksInput}"!`, flags: MessageFlags.Ephemeral }); // Changed from editReply to reply
                    break;

                default:
                    console.log(`Unhandled modal submission customId: ${interaction.customId}`);
                    break;
            }
        }
    });
}
