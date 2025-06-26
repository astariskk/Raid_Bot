import { EmbedBuilder, ChannelType } from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    ALLOWED_TASK_NAMES,
    TEMPLESHRINE_LIST
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

        // --- Handle "all = @user1 @user2" assignments, adding users to a global set. ---
        const allMatch = trimmedLine.match(/^all\s*=\s*(.*)/i);
        if (allMatch) {
            const userIds = extractUserIds(allMatch[1]);
            userIds.forEach(userId => globalTaggedUsers.add(userId));
            if (userIds.length > 0) hasValidTags = true;
            continue;
        }

        // --- Handle "task1+task2 = @user1" assignments, parsing tasks and assigning users. ---
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
 * Calculates the total points for a given set of tasks, expanding meta-tasks like 'daily' and 'weekly'.
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
        } else if (task === 'templeshrine') {
            TEMPLESHRINE_LIST.forEach(t => uniqueEffectiveTasks.add(t));
        }
        else if (POINTS_CONFIG[task]) {
            uniqueEffectiveTasks.add(task);
        }
    });

    let totalPoints = 0;
    uniqueEffectiveTasks.forEach(taskName => {
        totalPoints += POINTS_CONFIG[taskName] || 0;
    });

    return totalPoints;
}

/**
 * Determines the effective tasks and raw requested strings from the original raid request for validation purposes.
 * This helps ensure points are only awarded for tasks actually part of the raid.
 * @param {string} raidInfoTask - The raw task string from raidInfo.
 * @returns {{originalRaidEffectiveTasks: Set<string>, originalRaidRequestedStrings: Set<string>}}
 */
function getOriginalRaidTasks(raidInfoTask) {
    const originalRequestedTasksRaw = raidInfoTask.toLowerCase().split('+').map(t => t.trim());
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
        }
        else if (POINTS_CONFIG[task]) {
            originalRaidEffectiveTasks.add(task);
        }
    });
    return { originalRaidEffectiveTasks, originalRaidRequestedStrings };
}

/**
 * Awards points to globally tagged helpers based on all effective tasks from the original raid.
 * @param {Set<string>} globalTaggedUsers - Set of user IDs tagged with 'all'.
 * @param {Set<string>} originalRaidEffectiveTasks - Set of all effective tasks from the original raid.
 * @param {{[userId: string]: number}} pointsAwarded - Object to accumulate points.
 * @param {string[]} helperSummaries - Array to store summary strings for the embed.
 * @param {string} raidInfoTask - The raw task string from raidInfo.
 */
function awardGlobalHelperPoints(globalTaggedUsers, originalRaidEffectiveTasks, pointsAwarded, helperSummaries, raidInfoTask) {
    if (globalTaggedUsers.size > 0) {
        const totalPointsForGlobalHelpers = calculateTaskPoints(Array.from(originalRaidEffectiveTasks));

        if (totalPointsForGlobalHelpers > 0) {
            const helperNames = Array.from(globalTaggedUsers).map(id => `<@${id}>`).join(', ');
            helperSummaries.push(
                `**All Helpers:** ${helperNames} (Total ${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfoTask})`
            );
            globalTaggedUsers.forEach(userId => {
                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
            });
        }
    }
}

/**
 * Awards points to specifically assigned helpers, validating tasks against the original raid request.
 * @param {{[taskName: string]: Set<string>}} helperAssignments - Object of task-specific helper assignments.
 * @param {Set<string>} globalTaggedUsers - Set of user IDs tagged with 'all' to avoid double-counting.
 * @param {Set<string>} originalRaidEffectiveTasks - Set of all individual tasks from the original raid.
 * @param {Set<string>} originalRaidRequestedStrings - Set of raw task strings from the original raid (e.g., 'daily').
 * @param {{[userId: string]: number}} pointsAwarded - Object to accumulate points.
 * @param {string[]} helperSummaries - Array to store summary strings for the embed.
 * @param {Set<string>} mismatchedTasks - Set to store tasks that were assigned but not part of the original raid.
 */
function awardSpecificHelperPoints(
    helperAssignments,
    globalTaggedUsers,
    originalRaidEffectiveTasks,
    originalRaidRequestedStrings,
    pointsAwarded,
    helperSummaries,
    mismatchedTasks
) {
    for (const taskName in helperAssignments) {
        const usersForTask = Array.from(helperAssignments[taskName]);
        if (usersForTask.length === 0) continue;

        // --- Validate if the assigned task was part of the original raid request. ---
        let isValidAssignedTask = originalRaidRequestedStrings.has(taskName) || originalRaidEffectiveTasks.has(taskName);

        if (!isValidAssignedTask) {
            mismatchedTasks.add(taskName);
            continue;
        }

        const totalPointsForTask = calculateTaskPoints([taskName]);

        if (totalPointsForTask > 0) {
            const helperNames = usersForTask.map(id => `<@${id}>`).join(', ');
            helperSummaries.push(`**${taskName}:** ${helperNames} (${totalPointsForTask} EXP each)`);

            usersForTask.forEach(userId => {
                // --- Prevent double-counting points if a user was tagged with 'all' and also a specific task. ---
                // This ensures a user doesn't get points for the same task multiple times from one raid.
                if (!globalTaggedUsers.has(userId)) {
                    pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForTask;
                }
            });
        }
    }
}

/**
 * Constructs and sends the raid completion embed to the EXP Lair Channel.
 * This embed provides a summary of the completed raid, including participants and tasks.
 * @param {Message} message - The Discord message that triggered completion.
 * @param {TextChannel} expLairChannel - The channel to send the embed to.
 * @param {object} raidInfo - Information about the active raid.
 * @param {{[userId: string]: number}} pointsAwarded - Object of awarded points per user.
 * @param {Attachment | null} attachment - Optional screenshot attachment.
 * @param {string} detailsContent - The detailed breakdown content to include in the embed.
 * @returns {Promise<Message>} The sent message in the EXP Lair channel.
 */
async function sendCompletionEmbed(message, expLairChannel, raidInfo, pointsAwarded, attachment, detailsContent) {
    const allHelperIds = Object.keys(pointsAwarded);
    const helpersString = allHelperIds.length > 0 ? allHelperIds.map(id => `<@${id}>`).join(' ') : 'None';

    const embed = new EmbedBuilder()
        .setColor(COLOR_INFO)
        .setTitle(`Raid Completed by ${message.author.username}`)
        .setDescription(`Raid requested by: <@${raidInfo.requesterId}>\nTask(s): ${raidInfo.task}\nHelpers: ${helpersString}`)
        .addFields(
            { name: 'Points Breakdown & Helper Assignments', value: detailsContent || 'No detailed breakdown available.', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Raid Completion Report' });

    if (attachment) {
        embed.setImage(attachment.url);
    }

    return expLairChannel.send({
        content: `**Raid Completed!**`,
        embeds: [embed]
    });
}

/**
 * Handles the completion of a raid thread, awarding points and logging details.
 * This is the main function called when a raid requester indicates completion.
 * @param {Message} message - The Discord message triggering the completion.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCompletion(message, raidInfo) {
    console.log('--- Entering handleRaidCompletion ---');
    // --- Parse helper assignments and validate input. ---
    const { helperAssignments, globalTaggedUsers, hasValidTags, unrecognizedTasks } = parseHelperAssignments(message.content);
    const attachment = message.attachments.first();
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    console.log(`Parsed Assignments:`, { helperAssignments, globalTaggedUsers: Array.from(globalTaggedUsers), hasValidTags, unrecognizedTasks: Array.from(unrecognizedTasks) });
    console.log(`Attachment present: ${!!attachment}`);

    // --- Early exit if no valid tags or attachments are provided. ---
    // Prompts the user to correctly specify helpers or to explicitly cancel.
    if (!hasValidTags && !attachment) {
        console.log('DEBUG: No valid tags and no attachment. Returning early.');
        await message.reply(
            'To close the raid, please specify helpers for tasks (e.g.,\n`daily + dage = @user1` \nor \n`all = @user2 @user3`), \ninclude a screenshot if possible. Or type "cancel" to close without helpers.'
        );
        return;
    }

    console.log('DEBUG: Updating raid status to Done... (This updates the original message in raid-logs)');
    // --- Update the raid status to 'Done' in the ongoing raid message. ---
    // Visually indicates that the raid is no longer active in the main raid logs channel.
    await updateRaidStatus(message.client, threadId, '✅ Done', COLOR_SUCCESS);
    console.log('DEBUG: Raid status updated.');

    try {
        console.log('DEBUG: Fetching EXP Lair channel...');
        // --- Fetch the EXP Lair channel where completion reports are posted. ---
        // Ensures the bot can send the necessary logs to the designated channel.
        const expLairChannel = await message.client.channels.fetch(EXP_LAIR_CHANNEL_ID);
        if (!expLairChannel || expLairChannel.type !== ChannelType.GuildText) {
            console.error('EXP Lair channel not found or is not a text channel.');
            await message.reply('Could not find the EXP Lair channel to post the completion details.');
            console.log('DEBUG: EXP Lair channel error. Returning early.');
            return;
        }
        console.log('DEBUG: EXP Lair channel fetched.');

        const pointsAwarded = {};
        const helperSummaries = [];
        const mismatchedTasks = new Set(); // Tasks assigned but not part of original request

        // --- Get the original raid tasks and their effective components for validation. ---
        // This set of data is critical for ensuring only points for the *requested* tasks are awarded.
        const { originalRaidEffectiveTasks, originalRaidRequestedStrings } = getOriginalRaidTasks(raidInfo.task);
        console.log('DEBUG: Original Raid Tasks:', { originalRaidEffectiveTasks: Array.from(originalRaidEffectiveTasks), originalRaidRequestedStrings: Array.from(originalRaidRequestedStrings) });

        // --- Award points to users tagged with 'all' for all original raid tasks. ---
        // Simplifies point distribution for helpers who participated in all aspects of the raid.
        awardGlobalHelperPoints(globalTaggedUsers, originalRaidEffectiveTasks, pointsAwarded, helperSummaries, raidInfo.task);
        console.log('DEBUG: After awardGlobalHelperPoints:', { pointsAwarded, helperSummaries });

        // --- Award points to specifically assigned helpers, validating each task against the original raid. ---
        // Handles granular point assignments, ensuring accuracy and preventing point inflation for unrelated tasks.
        awardSpecificHelperPoints(
            helperAssignments,
            globalTaggedUsers,
            originalRaidEffectiveTasks,
            originalRaidRequestedStrings,
            pointsAwarded,
            helperSummaries,
            mismatchedTasks
        );
        console.log('DEBUG: After awardSpecificHelperPoints:', { pointsAwarded, helperSummaries, mismatchedTasks: Array.from(mismatchedTasks) });

        // --- Handle case where no valid helpers or tasks resulted in points. ---
        // Prevents the bot from proceeding if no valid points can be awarded.
        if (Object.keys(pointsAwarded).length === 0) {
            console.log('DEBUG: No points awarded. Returning early.');
            await message.reply('No valid helpers or tasks specified, or specified tasks were not part of the original request. Please tag helpers with tasks that were part of the raid, or type "cancel" to close without helpers.');
            return;
        }
        console.log('DEBUG: Points awarded. Proceeding.');


        // --- Build the detailed EXP Lair content to be included in the main embed ---
        let expLairDetailsContent = `**Task Initially Requested:** ${raidInfo.task}\n\n**Points Breakdown:**\n`;
        for (const userId in pointsAwarded) {
            expLairDetailsContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
        }
        expLairDetailsContent += `\n**Helper Assignments Breakdown:**\n${helperSummaries.join('\n')}\n`;

        // --- Add feedback for unrecognized and mismatched tasks to the detailed content ---
        if (unrecognizedTasks.size > 0) {
            const unrecognizedList = Array.from(unrecognizedTasks).map(t => `\`${t}\``).join(', ');
            expLairDetailsContent += (`\n**Note**: The following tasks mentioned in the completion message were not recognized as valid task names and no points were awarded for them: ${unrecognizedList}. Please use valid task names from \`!raidtasks\`.`);
        }
        
        if (mismatchedTasks.size > 0) {
            const mismatchedList = Array.from(mismatchedTasks).map(t => `\`${t}\``).join(', ');
            expLairDetailsContent += (`\n**Warning**: The following tasks were specified in the completion message but were NOT part of the original raid request (**${raidInfo.task}**) and thus no points were awarded for them: ${mismatchedList}.`);
        }
        console.log('DEBUG: Detailed EXP Lair content prepared.');


        console.log('DEBUG: Sending completion embed to EXP Lair...');
        // --- Construct and send the main raid completion embed to the EXP Lair Channel. ---
        // This creates the primary record of the completed raid.
        const sentExpLairMessage = await sendCompletionEmbed(message, expLairChannel, raidInfo, pointsAwarded, attachment, expLairDetailsContent);
        console.log('DEBUG: Completion embed sent.');

        // --- Create a new thread in EXP Lair for discussion ---
        // This thread is now just for general discussion about the completed raid, as details are in the embed.
        const expLairThread = await sentExpLairMessage.startThread({
            name: `COMPLETED-${raidInfo.task}- Raid for ${message.author.username}`,
            autoArchiveDuration: 60
        });
        // No separate message sent to this thread initially, as all content is in the parent embed.
        console.log('DEBUG: EXP Lair discussion thread created.');

        console.log('DEBUG: Updating leaderboard...');
        // --- Update the global leaderboard with the awarded points. ---
        // Persists the new EXP totals to the bot's data storage.
        for (const userId in pointsAwarded) {
            await updateLeaderboard(userId, pointsAwarded[userId]);
        }
        console.log('DEBUG: Leaderboard updated.');

        // --- Confirm successful closure to the user. ---
        // Informs the raid requester that their request has been processed.
        await message.reply('Raid closure details posted and points awarded!');
        console.log('DEBUG: Confirmation replied to original thread.');

        console.log('DEBUG: Deleting from activeRaidThreads and locking original raid thread...');
        // --- Clean up state and lock the original raid thread. ---
        // Removes the raid from active tracking and closes the discussion thread.
        delete activeRaidThreads[threadId];
        await originalRaidLogThread.setLocked(true); // This locks the thread
        await originalRaidLogThread.send('This raid thread is now complete and locked.');
        console.log('DEBUG: Original raid thread locked and state cleaned up. --- Exiting handleRaidCompletion successfully ---');
    } catch (error) {
        console.error('Error processing raid completion (caught by catch block):', error);
        await message.reply('There was an error processing the raid completion.');
        console.log('DEBUG: Error caught in handleRaidCompletion. --- Exiting handleRaidCompletion with error ---');
    }
}

/**
 * Handles 'cancel' command within a raid thread.
 * This function is responsible for gracefully closing a raid thread without awarding points.
 * @param {Message} message - The Discord message containing the 'cancel' command.
 * @param {object} raidInfo - Information about the active raid.
 */
async function handleRaidCancellation(message, raidInfo) {
    console.log('--- Entering handleRaidCancellation ---');
    const threadId = message.channel.id;
    const originalRaidLogThread = message.channel;

    // --- Reply to the user and update the status of the raid in the main logs. ---
    await message.reply('Raid thread closed without helpers/screenshot. Thread locked.');
    await updateRaidStatus(message.client, threadId, '❌ Cancelled', COLOR_CANCELLED);
    console.log('DEBUG: Raid status updated to Cancelled.');

    // --- Clean up state and lock the original raid thread. ---
    // Removes the raid from active tracking and prevents further interaction in the thread.
    delete activeRaidThreads[threadId];
    await originalRaidLogThread.setLocked(true);
    console.log('DEBUG: Original raid thread locked and state cleaned up. --- Exiting handleRaidCancellation successfully ---');
}

/**
 * Sets up event handlers for EXP Lair functionalities.
 * This includes listening for messages and button interactions within raid threads
 * to trigger completion or cancellation.
 * @param {Client} client - The Discord client.
 */
export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion/cancellation messages in raid threads) ---
    // This listener processes commands like "all = @user" or "cancel" coming from raid requesters within their threads.
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots

        const raidInfo = activeRaidThreads[message.channel.id];

        // --- Validate message context: must be a thread, an active raid, and from the requester. ---
        // Ensures that only valid commands from the correct user in the right context are processed.
        if (
            !message.channel.isThread() ||
            !raidInfo ||
            !raidInfo.awaitingCompletion || // Only process if the close button has been clicked
            message.author.id !== raidInfo.requesterId
        ) {
            return;
        }

        const contentLower = message.content.toLowerCase().trim();
        const attachment = message.attachments.first();

        // --- Handle cancellation command ---
        // If the user types 'cancel' without tagging anyone or attaching a screenshot, the raid is cancelled.
        if (contentLower === 'cancel' && message.mentions.users.size === 0 && !attachment) {
            await handleRaidCancellation(message, raidInfo);
            return;
        }

        // --- Handle raid completion details ---
        // If it's not a cancellation, the message is passed to the raid completion handler for point assignment.
        await handleRaidCompletion(message, raidInfo);
    });

    // --- Interaction Create Listener (for closeRaidTicket button) ---
    // This listener triggers the start of the raid completion/cancellation process.
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() || interaction.customId !== 'closeRaidTicket') {
            return; // Only process 'closeRaidTicket' button interactions
        }

        if (!interaction.channel.isThread()) {
            await interaction.reply({ content: 'This button can only be used in a raid thread.', ephemeral: true });
            return;
        }

        let raidInfo = activeRaidThreads[interaction.channel.id];

        // --- Re-initialize raidInfo if bot restarted and state was lost ---
        // This block attempts to reconstruct raid details if the bot's in-memory state was cleared
        // (e.g., after a restart). It fetches information from the thread's parent message embed.
        if (!raidInfo) {
            const threadId = interaction.channel.id;
            console.warn(`RaidInfo for thread ${threadId} not found in activeRaidThreads. Attempting to reconstruct.`);
            try {
                // Fetch the parent message of the thread to get the original raid request embed.
                // The parentId is the channel ID where the thread was started, and the thread's ID
                // is often the same as the message ID that *started* it in that channel.
                const parentChannel = await interaction.client.channels.fetch(interaction.channel.parentId);
                const parentMessage = await parentChannel.messages.fetch(threadId); // Fetch the message that created the thread

                if (parentMessage && parentMessage.embeds.length > 0) {
                    const originalEmbed = parentMessage.embeds[0];
                    const taskField = originalEmbed.fields.find(field => field.name === 'Task(s)');
                    const requesterField = originalEmbed.fields.find(field => field.name === 'Requested By');
                    const mapField = originalEmbed.fields.find(field => field.name === 'Map Name');
                    const serverField = originalEmbed.fields.find(field => field.name === 'Server');
                    const descriptionField = originalEmbed.fields.find(field => field.name === 'Description');

                    // Reconstruct raidInfo object
                    raidInfo = {
                        messageId: parentMessage.id,
                        originalChannelId: parentChannel.id, // This is the parent channel's ID
                        task: taskField ? taskField.value : 'unknown',
                        requesterId: requesterField ? requesterField.value.replace(/<@!?(\d+)>/, '$1') : interaction.user.id,
                        mapName: mapField ? mapField.value : 'N/A',
                        server: serverField ? serverField.value : 'N/A',
                        description: descriptionField ? descriptionField.value : 'N/A',
                        awaitingCompletion: false
                    };
                    activeRaidThreads[threadId] = raidInfo; // Store the reconstructed info
                    console.log(`Successfully reconstructed raidInfo for thread ${threadId}.`);
                } else {
                    console.warn(`No embed found in parent message for thread ${threadId}.`);
                }
            } catch (error) {
                console.error(`Failed to reconstruct raidInfo for thread ${threadId} from parent message:`, error);
                // Fallback to minimal reconstruction if message fetching fails entirely
                raidInfo = {
                    task: interaction.channel.name.split(' | ')[0]?.toLowerCase() || 'unknown', // Attempt to guess task from thread name
                    requesterId: interaction.user.id, // Assume requester is the one clicking for fallback
                    mapName: 'N/A', server: 'N/A', description: 'N/A',
                    awaitingCompletion: false
                };
                activeRaidThreads[threadId] = raidInfo;
                console.log(`Reconstructed minimal raidInfo for thread ${threadId} as fallback.`);
            }
        }

        // --- Check if the user closing the ticket is the original requester. ---
        // Ensures only the person who started the raid can finalize its closure.
        if (interaction.user.id !== raidInfo.requesterId) {
            await interaction.reply({ content: 'Only the user who initiated this raid can close it.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true }); // Acknowledge the button click

        // --- Set awaitingCompletion flag and instruct user on next steps. ---
        // This flag signals to the messageCreate listener that the next message from the requester
        // should be treated as a raid completion or cancellation instruction.
        raidInfo.awaitingCompletion = true;
        console.log(`Thread ${interaction.channel.id} now awaiting completion details.`);

        await interaction.editReply({
            content: 'Please specify helpers e.g. \n`daily = @user1 @user2` \nor \n`speaker + dage = @user1 @user2` \ninclude a screenshot if possible. Or type "cancel" to close the thread.',
            ephemeral: false // Make this visible to others in the thread
        });
    });
}
