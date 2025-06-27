import { EmbedBuilder, ChannelType } from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    ALLOWED_TASK_NAMES,
    TEMPLESHRINE_LIST // <<< NEW: Import TEMPLESHRINE_LIST
} from '../config/constants.js';
import { updateLeaderboard } from '../utils/fileOps.js';
import { activeRaidThreads, updateRaidStatus } from './sharedState.js';

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
 * Parses the message content to identify helper assignments for tasks.
 * It also returns any tasks that were not recognized by ALLOWED_TASK_NAMES.
 * @param {string} content - The message content.
 * @returns {{helperAssignments: {[taskName: string]: Set<string>}, globalTaggedUsers: Set<string>, hasValidTags: boolean, unrecognizedTasks: Set<string>}}
 */
function parseHelperAssignments(content) {
    const helperAssignments = {};
    const globalTaggedUsers = new Set();
    let hasValidTags = false;
    const unrecognizedTasks = new Set();

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

        // Handle "task1+task2 = @user1" assignments
        const taskMatch = trimmedLine.match(/^(.+?)\s*=\s*(.*)/i);
        if (taskMatch) {
            const taskPart = taskMatch[1].trim();
            const userMentionPart = taskMatch[2].trim();

            const tasks = taskPart.split('+').map(t => t.trim().toLowerCase());
            const userIds = extractUserIds(userMentionPart);

            if (userIds.length > 0 && tasks.length > 0) {
                hasValidTags = true;
                userIds.forEach(userId => {
                    tasks.forEach(taskName => {
                        // Only add to helperAssignments if it's a known ALLOWED_TASK_NAME
                        // The deeper validation against original raid tasks happens in handleRaidCompletion
                        if (ALLOWED_TASK_NAMES.includes(taskName)) {
                            if (!helperAssignments[taskName]) {
                                helperAssignments[taskName] = new Set();
                            }
                            helperAssignments[taskName].add(userId);
                        } else {
                            unrecognizedTasks.add(taskName);
                        }
                    });
                });
            }
        }
    }
    return { helperAssignments, globalTaggedUsers, hasValidTags, unrecognizedTasks };
}

/**
 * Calculates the total points for a given set of tasks.
 * Handles meta-tasks like 'daily', 'weekly', and 'templeshrine' and combines them with explicit tasks.
 * @param {string[]} tasks - An array of task names.
 * @returns {number} The total points.
 */
function calculateTaskPoints(tasks) {
    let uniqueEffectiveTasks = new Set();

    tasks.forEach(task => {
        if (task === 'daily' || task === 'dailies') {
            DAILIES_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        } else if (task === 'weekly' || task === 'weeklies') {
            WEEKLIES_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        } else if (task === 'templeshrine') { // <<< NEW: Handle 'templeshrine' meta-task
            TEMPLESHRINE_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        }
        else if (POINTS_CONFIG[task]) {
            uniqueEffectiveTasks.add(task);
        }
        // No else/warn here, as `parseHelperAssignments` and `handleRaidCompletion` handle filtering
    });

    let totalPoints = 0;
    uniqueEffectiveTasks.forEach(taskName => {
        totalPoints += POINTS_CONFIG[taskName] || 0;
    });

    return totalPoints;
}

/**
 * Handles the completion of a raid thread.
 * @param {Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCompletion(message, raidInfo) {
    const { helperAssignments, globalTaggedUsers, hasValidTags, unrecognizedTasks } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    if (!hasValidTags && !attachment) {
        await message.reply(
            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dage = @user1 @user2`'
            +`\n* You can use \`All\` to refer to every requested task'`
            +`\n* Include a screenshot if possible.`
            +`\n* You can type \`cancel\` to close the thread without tagging helpers.`,
            { ephemeral: true }
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

        const pointsAwarded = {};
        const helperSummaries = [];
        const mismatchedTasks = new Set(); // New set for tasks assigned that weren't in original request

        // 1. Determine all effective tasks AND raw requested strings from the ORIGINAL raid request
        const originalRequestedTasksRaw = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
        const originalRaidEffectiveTasks = new Set(); // For individual task validation (e.g. ultraspeaker)
        const originalRaidRequestedStrings = new Set(); // For validating meta-tasks like 'daily', 'weekly', etc.

        originalRequestedTasksRaw.forEach(task => {
            originalRaidRequestedStrings.add(task); // Add the raw string, e.g., 'daily', 'weekly', 'ultraspeaker'
            if (task === 'daily' || task === 'dailies') {
                DAILIES_LIST.forEach(t => originalRaidEffectiveTasks.add(t));
            } else if (task === 'weekly' || task === 'weeklies') {
                WEEKLIES_LIST.forEach(t => originalRaidEffectiveTasks.add(t));
            } else if (task === 'templeshrine') {
                TEMPLESHRINE_LIST.forEach(t => originalRaidEffectiveTasks.add(t));
            }
            else if (POINTS_CONFIG[task]) { // Add individual tasks if they exist in POINTS_CONFIG
                originalRaidEffectiveTasks.add(task);
            }
        });

        // 2. Calculate points for 'all' tagged helpers
        // 'all' helpers are assumed to have helped with everything originally requested
        if (globalTaggedUsers.size > 0) {
            const totalPointsForGlobalHelpers = calculateTaskPoints(Array.from(originalRaidEffectiveTasks));

            if (totalPointsForGlobalHelpers > 0) {
                const helperNames = Array.from(globalTaggedUsers).map(id => `<@${id}>`).join(', ');
                helperSummaries.push(
                    `**All Helpers:** ${helperNames} (Total ${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfo.task})`
                );
                globalTaggedUsers.forEach(userId => {
                    pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
                });
            }
        }

        // 3. Calculate points for specifically assigned helpers, validating against original raid tasks
        for (const taskName in helperAssignments) {
            const usersForTask = Array.from(helperAssignments[taskName]);
            if (usersForTask.length === 0) continue;

            // --- VALIDATION LOGIC FIX HERE ---
            let isValidAssignedTask = false;
            // Check if the assigned task name was one of the *raw strings* originally requested (e.g., 'daily', 'weekly')
            if (originalRaidRequestedStrings.has(taskName)) {
                isValidAssignedTask = true;
            } else {
                // If not a raw requested string, check if it's an *individual effective task*
                // that was part of the original request's breakdown (e.g., 'ultraspeaker' if 'daily' was requested)
                isValidAssignedTask = originalRaidEffectiveTasks.has(taskName);
            }

            if (!isValidAssignedTask) {
                mismatchedTasks.add(taskName); // Add to mismatched set for feedback
                continue; // Skip awarding points for this task
            }
            // --- END VALIDATION LOGIC FIX ---

            const totalPointsForTask = calculateTaskPoints([taskName]);

            if (totalPointsForTask > 0) {
                const helperNames = usersForTask.map(id => `<@${id}>`).join(', ');
                helperSummaries.push(`**${taskName}:** ${helperNames} (${totalPointsForTask} EXP each)`);

                usersForTask.forEach(userId => {
                    // Only add points if the user wasn't covered by "all" to avoid double counting
                    // This check is fine as it prevents double counting for a *single user*
                    // who might be tagged with 'all' AND also a specific task.
                    if (!globalTaggedUsers.has(userId)) {
                        pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForTask;
                    }
                });
            }
        }

        if (Object.keys(pointsAwarded).length === 0) {
            await message.reply('No valid helpers or tasks specified, or specified tasks were not part of the original request. Please tag helpers with tasks that were part of the raid, or type "cancel" to close without helpers.');
            return;
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

        for (const userId in pointsAwarded) {
            expLairThreadContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
        }

        expLairThreadContent += `\n**Helper Assignments Breakdown:** \n${helperSummaries.join('\n')}\n`;

        // Provide feedback for unrecognized tasks (parsed but not in ALLOWED_TASK_NAMES)
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairThreadContent += (`**Note**: The following tasks were not recognized and earned no points: ${unrecognizedList}. Use valid task names from \`!raidtasks\`.\n`);
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
 * @param {Message} message - The Discord message containing the 'cancel' command.
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
 * @param {Client} client - The Discord client.
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
            !raidInfo.awaitingCompletion ||
            message.author.id !== raidInfo.requesterId
        ) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();
        const attachment = message.attachments.first();

        // Handle cancellation
        if (contentLower === 'cancel' && message.mentions.users.size === 0 && !attachment) {
            await handleRaidCancellation(message, raidInfo);
            return;
        }

        // Handle raid completion
        await handleRaidCompletion(message, raidInfo);
    });

    // --- Interaction Create Listener (for closeRaidTicket button) ---
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() || interaction.customId !== 'closeRaidTicket') {
            return;
        }

        if (!interaction.channel.isThread()) {
            await interaction.reply({ content: 'This button can only be used in a raid thread.', ephemeral: true });
            return;
        }

        let raidInfo = activeRaidThreads[interaction.channel.id];

        // Re-initialize raidInfo if bot restarted and state was lost
        if (!raidInfo) {
            const threadName = interaction.channel.name.toLowerCase();
            let taskFromThread = 'unknown';

            // Find task from thread name
            // Note: This attempts to guess the task from the thread name if state is lost.
            // It might not perfectly reconstruct complex 'task + task' combinations
            // but provides a fallback.
            for (const allowedTask of ALLOWED_TASK_NAMES) {
                if (threadName.includes(allowedTask.toLowerCase())) {
                    taskFromThread = allowedTask;
                    break;
                }
            }

            // Attempt to get the original message and parse its embed to reconstruct raidInfo
            // This is a more robust way to handle bot restarts and missing activeRaidThreads entries
            try {
                // Assuming the parent message is the message that started this thread (which Discord usually links)
                // This might need adjustment if your thread creation logic has changed significantly
                const parentChannel = await interaction.client.channels.fetch(interaction.channel.parentId);
                const parentMessage = await parentChannel.messages.fetch(interaction.channel.id); // Fetch the message that created the thread, which has the ID of the thread itself

                if (parentMessage && parentMessage.embeds.length > 0) {
                    const originalEmbed = parentMessage.embeds[0];
                    const taskField = originalEmbed.fields.find(field => field.name === 'Task(s)');
                    const requesterField = originalEmbed.fields.find(field => field.name === 'Requested By');
                    const mapField = originalEmbed.fields.find(field => field.name === 'Map Name');
                    const serverField = originalEmbed.fields.find(field => field.name === 'Server');
                    const descriptionField = originalEmbed.fields.find(field => field.name === 'Description');

                    raidInfo = {
                        messageId: parentMessage.id,
                        originalChannelId: interaction.channel.parentId, // Corrected to use parentId
                        task: taskField ? taskField.value : taskFromThread,
                        requesterId: requesterField ? requesterField.value.replace(/<@!?(\d+)>/, '$1') : interaction.user.id,
                        mapName: mapField ? mapField.value : 'N/A',
                        server: serverField ? serverField.value : 'N/A',
                        description: descriptionField ? descriptionField.value : 'N/A',
                        awaitingCompletion: false // Reset this, will be set to true below
                    };
                    activeRaidThreads[interaction.channel.id] = raidInfo;
                    console.log(`Reconstructed raidInfo for thread ${interaction.channel.id}`);
                }
            } catch (error) {
                console.warn(`Could not reconstruct raidInfo from parent message for thread ${interaction.channel.id}:`, error);
                // Fallback to minimal reconstruction if message fetching fails
                raidInfo = {
                    task: taskFromThread,
                    requesterId: interaction.user.id, // Assume requester is the one clicking for fallback
                    mapName: 'N/A',
                    server: 'N/A',
                    description: 'N/A',
                    awaitingCompletion: false
                };
                activeRaidThreads[interaction.channel.id] = raidInfo;
            }
        }

        // Check if the user closing the ticket is the requester
        if (interaction.user.id !== raidInfo.requesterId) {
            await interaction.reply({ content: 'Only the user who initiated this raid can close it.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        raidInfo.awaitingCompletion = true;
        console.log(`Thread ${interaction.channel.id} now awaiting completion details.`);

        await interaction.editReply({
        content:
            'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dage = @user1 @user2`'
            + `\n* You can use \`All\` to refer to every requested task`
            + `\n* Include a screenshot if possible.`
            + `\n* You can type \`cancel\` to close the thread without tagging helpers.`,
        ephemeral: true
        });
    });
}