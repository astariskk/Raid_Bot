// handlers/expLairHandler.js
import { EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    ALLOWED_TASK_NAMES,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    MAX_XP_PER_RAID,
    CUSTOM_TASK_PREFIX, // Import the new custom task prefix
    MODERATOR_ROLE_ID // Import Moderator Role ID
} from '../config/constants.js';
import { updateLeaderboard } from '../utils/fileOps.js';
import { getTasksEmbed } from './raidLogsHandler.js'; // Still needed for validation feedback
import { activeRaidThreads, updateRaidStatus, getEditTaskModal, updateRaidLogEmbed } from '../activeRaidState.js';

// --- Constants for Embed Colors ---
const COLOR_SUCCESS = 0x57F287; // Green
const COLOR_CANCELLED = 0xFF4500; // Red
const COLOR_INFO = 0x0099ff; // Blue

/**
 * Extracts user IDs from a string containing mentions.
 * @param {string} text - The text possibly containing user mentions.
 * @returns {string[]} An array of user IDs.
 */
function extractUserIds(text) {
    return (text.match(/<@!?(\d+)>/g) || []).map(mention =>
        mention.replace(/<@!?(\d+)>/, '$1')
    );
}

/**
 * Parses the message content to identify helper assignments for tasks, including multipliers.
 * It also returns any tasks that were not recognized by ALLOWED_TASK_NAMES OR the custom prefix.
 * Handles 'task = @user', 'taskxN = @user', and 'all = @user' assignments, and 'custom:taskname = @user'.
 * @param {string} content - The message content.
 * @returns {{helperAssignments: {[taskName: string]: {users: Set<string>, multiplier: number}}, globalTaggedUsers: Set<string>, hasValidTags: boolean, unrecognizedTasks: Set<string>, customTasksDetected: boolean}}
 */
function parseHelperAssignments(content) {
    const helperAssignments = {}; // Stores { 'taskName': { users: Set<string>, multiplier: number } }
    const globalTaggedUsers = new Set();
    let hasValidTags = false;
    const unrecognizedTasks = new Set();
    let customTasksDetected = false; // New flag for custom tasks

    const lines = content.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Handle "all = @user1 @user2" assignments
        const allMatch = trimmedLine.match(/^all\s*=\s*(.*)/i);
        if (allMatch) {
            const userIds = extractUserIds(allMatch[1]);
            userIds.forEach(userId => globalTaggedUsers.add(userId));
            if (userIds.length > 0) hasValidTags = true;
            continue;
        }

        // Handle "task1+task2 = @user1" or "task1xN = @user1" assignments
        const taskMatch = trimmedLine.match(/^(.+?)(x(\d+))?\s*=\s*(.*)/i);
        if (taskMatch) {
            let taskPart = taskMatch[1].trim(); 
            const multiplierStr = taskMatch[3]; 
            const userMentionPart = taskMatch[4].trim();

            const multiplier = multiplierStr ? parseInt(multiplierStr, 10) : 1;
            if (isNaN(multiplier) || multiplier < 1) { 
                unrecognizedTasks.add(taskPart + (multiplierStr ? 'x' + multiplierStr : ''));
                continue;
            }

            const tasks = taskPart.split('+').map(t => t.trim().toLowerCase());
            const userIds = extractUserIds(userMentionPart);

            if (userIds.length > 0 && tasks.length > 0) {
                hasValidTags = true;
                userIds.forEach(userId => {
                    tasks.forEach(taskName => {
                        // Check for known ALLOWED_TASK_NAMES or a custom task prefix
                        if (ALLOWED_TASK_NAMES.includes(taskName) || taskName.startsWith(CUSTOM_TASK_PREFIX)) {
                            if (!helperAssignments[taskName]) {
                                helperAssignments[taskName] = { users: new Set(), multiplier: 1 };
                            }
                            helperAssignments[taskName].users.add(userId);
                            helperAssignments[taskName].multiplier = multiplier; 
                            
                            if (taskName.startsWith(CUSTOM_TASK_PREFIX)) {
                                customTasksDetected = true; // Mark that a custom task was found
                            }
                        } else {
                            unrecognizedTasks.add(taskName);
                        }
                    });
                });
            }
        }
    }
    return { helperAssignments, globalTaggedUsers, hasValidTags, unrecognizedTasks, customTasksDetected };
}

/**
 * Calculates the total points for a given set of tasks.
 * Handles meta-tasks like 'daily', 'weekly', 'templeshrine', and 'originul'.
 * Custom tasks (starting with CUSTOM_TASK_PREFIX) will return 0 points here,
 * as their points need to be manually assigned by a moderator.
 * @param {string[]} tasks - An array of task names.
 * @returns {number} The total points.
 */
function calculateTaskPoints(tasks) {
    let uniqueEffectiveTasks = new Set();

    tasks.forEach(task => {
        if (task.startsWith(CUSTOM_TASK_PREFIX)) {
            // Custom tasks initially award 0 points. Moderator needs to intervene.
            uniqueEffectiveTasks.add(task); // Add to unique tasks to track it
            return; 
        }

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
        // If it's a custom task, its POINTS_CONFIG[taskName] will be undefined, resulting in 0 points.
        totalPoints += (POINTS_CONFIG[taskName] || 0); 
    });

    return totalPoints; 
}

/**
 * Handles the completion of a raid thread.
 * @param {import('discord.js').Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, hasValidTags, unrecognizedTasks, customTasksDetected } = parseHelperAssignments(message.content);
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
                 if (user.bot) {
                    await message.channel.send(`Heads up! Bots cannot be awarded points. Ignoring <@${userId}> for this submission.`);
                    continue;
                } 
                validUserIds.add(userId);
            } catch (error) {
                console.error(`Could not fetch user ${userId} during validation:`, error);
                await message.channel.send(`Warning: Could not verify user <@${userId}>. Skipping them for points.`);
            }
        }
        return validUserIds;
    };

    // If no valid tags and no screenshot, prompt for input
    if (!hasValidTags && !attachment) {
        await message.reply(
            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 = @user1 @user2`'
            +`\n* You can use \`All\` to refer to every requested task`
            +`\n* Include a screenshot if possible.`
            +`\n* You can type \`cancel\` to close the thread without tagging helpers.`
            +`\n* For multiple tasks, use \`task1 + task2 = @user\` or \`task1xN = @user\` format.`
            +`\n* For custom tasks, use \`custom:yourtaskname = @user\` (Moderators will assign points manually).`,
        );
        return;
    }

    await updateRaidStatus(message.client, threadId, '✅ Done', COLOR_SUCCESS);

    try {
        const expLairChannel = await message.client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel.');
            await message.reply('Could not find the EXP Lair channel to post the completion details.');
            return;
        }

        const pointsAwarded = {}; // Stores total points per user
        const helperSummaries = [];
        const mismatchedTasks = new Set(); // Tasks mentioned in completion but not in original request
        const customTasksInCompletion = new Set(); // Stores actual custom tasks found in completion submission

        // 1. Determine all effective tasks AND raw requested strings from the ORIGINAL raid request
        const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
        const originalRaidEffectiveTasks = new Set(); 
        const originalRaidRequestedStrings = new Set(); 

        originalRequestedTasksRaw.forEach(task => {
            originalRaidRequestedStrings.add(task); 
            if (task === 'daily' || task === 'dailies') {
                DAILIES_LIST.forEach(t => originalRaidEffectiveTasks.add(t));
            } else if (task === 'weekly' || task === 'weeklies') {
                WEEKLIES_LIST.forEach(t => originalRaidEffectiveTasks.add(t));
            } else if (task === 'templeshrine') {
                TEMPLESHRINE_LIST.forEach(t => originalRaidEffectiveTasks.add(t)); 
            } else if (task === 'originul') {
                ORIGINUL_LIST.forEach(t => originalRaidEffectiveTasks.add(t)); 
            } else if (task.startsWith(CUSTOM_TASK_PREFIX)) {
                originalRaidEffectiveTasks.add(task); // Custom tasks are part of original effective tasks
            }
            else if (POINTS_CONFIG[task]) { 
                originalRaidEffectiveTasks.add(task);
            }
        });

        // 2. Calculate points for 'all' tagged helpers
        const validGlobalTaggedUsers = await filterValidUsers(globalTaggedUsers);
        if (validGlobalTaggedUsers.size > 0) {
            const tasksForGlobalHelpers = Array.from(originalRaidEffectiveTasks);
            const totalPointsForGlobalHelpers = calculateTaskPoints(tasksForGlobalHelpers); // Custom tasks will be 0 here

            // Identify if any custom tasks were assigned globally
            tasksForGlobalHelpers.filter(t => t.startsWith(CUSTOM_TASK_PREFIX)).forEach(t => customTasksInCompletion.add(t));

            const helperNames = Array.from(validGlobalTaggedUsers).map(id => `<@${id}>`).join(', ');
            helperSummaries.push(
                `**All Helpers:** ${helperNames} (Total ${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfo.task})`
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
            // Check if the raw task name (e.g., 'daily', 'dage') was part of the original request
            if (originalRaidRequestedStrings.has(taskName)) {
                isValidAssignedTask = true;
            } else {
                // If not a raw string match, check if it's one of the effective individual tasks (e.g., 'ezrajal' if 'daily' was requested)
                // This also covers custom tasks if they were in the original request
                isValidAssignedTask = originalRaidEffectiveTasks.has(taskName);
            }

            if (!isValidAssignedTask) {
                mismatchedTasks.add(taskName + (multiplier > 1 ? `x${multiplier}` : ''));
                continue;
            }
            
            // If it's a custom task, add it to the set for moderator notification
            if (taskName.startsWith(CUSTOM_TASK_PREFIX)) {
                customTasksInCompletion.add(taskName);
            }

            let pointsForThisTask = calculateTaskPoints([taskName]); // Custom tasks will yield 0 points here
            pointsForThisTask *= multiplier; 

            if (pointsForThisTask > 0 || taskName.startsWith(CUSTOM_TASK_PREFIX)) { // Include custom tasks in summary even if 0 points
                const helperNames = Array.from(usersForTask).map(id => `<@${id}>`).join(', ');
                const expText = taskName.startsWith(CUSTOM_TASK_PREFIX) ? `**MANUAL EXP Needed**` : `${pointsForThisTask} EXP`;
                helperSummaries.push(`**${taskName}${multiplier > 1 ? `x${multiplier}` : ''}:** ${helperNames} (${expText} each)`);

                // Only add points if it's not a custom task (or if POINTS_CONFIG has a value for it)
                if (pointsForThisTask > 0) { 
                    usersForTask.forEach(userId => {
                        pointsAwarded[userId] = (pointsAwarded[userId] || 0) + pointsForThisTask;
                    });
                }
            }
        }

        if (Object.keys(pointsAwarded).length === 0 && !hasValidTags && customTasksInCompletion.size === 0) {
            await message.reply('No valid helpers or tasks specified, or specified tasks were not part of the original request. Please tag helpers with tasks that were part of the raid, or type "cancel" to close without helpers.');
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

        // Provide feedback for unrecognized tasks (parsed but not in ALLOWED_TASK_NAMES or custom prefix)
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`**Note**: The following tasks were not recognized and earned no points: ${unrecognizedList}. Use valid task names from \`!raidtasks\` or \`custom:taskname\`.\n`);
        }

        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`\n**Warning**: These tasks weren't part of the original raid (**${raidInfo.task}**) and earned no points: ${mismatchedList}.`);
        }

        // MODIFICATION: Add a special message and tag moderator if custom tasks were detected
        if (customTasksInCompletion.size > 0) {
            const customTasksList = Array.from(customTasksInCompletion).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += `\n\n<@&${MODERATOR_ROLE_ID}> **Moderator Attention Required:**
This raid completion included custom tasks: ${customTasksList}. Please manually review and assign EXP using \`!addxp\` if necessary.`;
        }


        // Send the detailed content to the new thread
        await expLairThread.send({ content: expLairThreadContent });

        // Update leaderboard (moved after sending messages for better flow, but can be done earlier)
        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }

        // Confirm to the original raid thread that details are posted
        await message.reply('Raid closure details posted and points awarded in the EXP Lair!');

        // Clean up and lock original raid thread
        delete activeRaidThreads[threadId];
        await originalRaidLogThread.setLocked(true);
        await originalRaidLogThread.send('This raid thread is now complete and locked.');
    } catch (error) {
        console.error('Error processing raid completion:', error);
        await message.reply('There was an error processing the raid completion.');
    }
}

/**
 * Handles 'cancel' command within a raid thread.
 * @param {import('discord.js').Message} message - The Discord message containing the 'cancel' command.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCancellation(message, raidInfo) {
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    await message.reply('Raid thread closed without helpers/screenshot. Thread locked.');
    await updateRaidStatus(message.client, threadId, '❌ Cancelled', COLOR_CANCELLED);
    delete activeRaidThreads[threadId];
    await originalRaidLogThread.setLocked(true);
}


/**
 * Sets up event handlers for EXP Lair functionalities.
 * @param {import('discord.js').Client} client - The Discord client.
 */
export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion/cancellation messages in raid threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = activeRaidThreads[message.channel.id];

        // Ensure it's a thread and we have active raid info for it, and the message is from the requester
        if (
            !message.channel.isThread() ||
            !raidInfo ||
            message.author.id !== raidInfo.requesterId
        ) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();
        const attachment = message.attachments.first();

        // Handle cancellation - only if awaiting completion confirmation
        if (raidInfo.awaitingCompletion && contentLower === 'cancel' && message.mentions.users.size === 0 && !attachment) {
            await handleRaidCancellation(message, raidInfo);
            return;
        }

        // Handle raid completion - only if awaiting completion confirmation
        if (raidInfo.awaitingCompletion) {
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
            // These buttons/modals are expected only in threads; reply if used elsewhere
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

        // Reconstruct raidInfo if bot restarted and state was lost (only for raid threads)
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
                        awaitingCompletion: false
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


        // Ensure the user interacting is the raid requester for critical actions
        if (interaction.user.id !== raidInfo.requesterId) {
            await interaction.reply({ content: 'Only the user who initiated this raid can perform this action.', flags: MessageFlags.Ephemeral });
            return;
        }

        // --- Handle Button Interactions ---
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'closeRaidTicket':
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    raidInfo.awaitingCompletion = true;
                    console.log(`Thread ${interaction.channel.id} now awaiting completion details.`);

                    await interaction.editReply({
                        content:
                            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dagex2 = @user1 @user2`'
                            + `\n* You can use \`All\` to refer to every requested task`
                            + `\n* Include a screenshot if possible.`
                            + `\n* You can type \`cancel\` to close the thread without tagging helpers.`
                            + `\n* For multiple tasks, use \`task1 + task2 = @user\` or \`task1xN = @user\` format.`
                            + `\n* For custom tasks, use \`custom:yourtaskname = @user\` (Moderators will assign points manually).`, // Added custom task instruction
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

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    // Validate new tasks, including custom tasks
                    for (const taskName of newTasksArray) {
                        if (!ALLOWED_TASK_NAMES.includes(taskName) && !taskName.startsWith(CUSTOM_TASK_PREFIX)) { // Check for custom prefix
                            await interaction.editReply({
                                content: `Invalid task "${taskName}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                                embeds: [getTasksEmbed()],
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

                    await interaction.editReply({ content: `Successfully updated raid tasks to "${editedTasksInput}"!`, flags: MessageFlags.Ephemeral });
                    break;

                default:
                    console.log(`Unhandled modal submission customId: ${interaction.customId}`);
                    break;
            }
        }
    });
}
