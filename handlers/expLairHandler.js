import {
    EmbedBuilder,
    ChannelType
} from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG, // Import from constants
    DAILIES_LIST, // Import from constants
    WEEKLIES_LIST, // Import from constants
    ALLOWED_TASK_NAMES // Import from constants
} from '../config/constants.js'; // Centralized constants
import { updateLeaderboard } from '../utils/fileOps.js';

// --- Global state for active raid threads ---
// This is exported so raidLogsHandler can add to it.
export const activeRaidThreads = {}; // Maps thread ID to an object containing { task: 'weekly', requesterId: 'userId', awaitingCompletion: true/false, ...otherDetails }

export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion messages in raid threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots

        // Only process messages in active raid threads that are specifically awaiting completion details
        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && raidInfo.awaitingCompletion && message.author.id === raidInfo.requesterId) {
            const threadId = message.channel.id;
            const originalRaidLogThread = message.channel; // Reference to the original raid log thread

            const attachment = message.attachments.first();
            const contentLower = message.content.toLowerCase().trim();

            // Check if the user is just saying "done" to close without points/screenshot
            if (contentLower === 'done' && message.mentions.users.size === 0 && !attachment) {
                await message.reply('Raid thread closed without helpers/screenshot. Thread locked.');
                delete activeRaidThreads[threadId];
                await originalRaidLogThread.setLocked(true); // Lock the original thread
                return; // Exit here, don't try to post to exp-lair
            }

            // --- Logic for parsing helper tags and tasks ---
            const helperAssignments = {}; // Stores specific task assignments
            let globalTaggedUsers = new Set(); // Stores users tagged with 'all='
            let hasValidTags = false;

            // Split the message content by new lines to parse individual assignments
            const lines = message.content.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // Check for "All = @user1 @user2" format
                const allMatch = trimmedLine.match(/^all\s*=\s*(.*)/i);
                if (allMatch) {
                    const userMentions = allMatch[1].match(/<@!?(\d+)>/g);
                    if (userMentions) {
                        userMentions.forEach(mention => {
                            const userId = mention.replace(/<@!?(\d+)>/, '$1');
                            globalTaggedUsers.add(userId);
                            hasValidTags = true;
                        });
                    }
                    continue; // Process next line
                }

                // Check for "TaskName = @user1 @user2" or "TaskName + TaskName2 = @user1 @user2" format
                const taskMatch = trimmedLine.match(/^(.+?)\s*=\s*(.*)/i);
                if (taskMatch) {
                    const taskPart = taskMatch[1].trim();
                    const userMentionPart = taskMatch[2].trim();

                    const tasks = taskPart.split('+').map(t => t.trim().toLowerCase());
                    const userMentions = userMentionPart.match(/<@!?(\d+)>/g);

                    if (userMentions && tasks.length > 0) {
                        hasValidTags = true;
                        userMentions.forEach(mention => {
                            const userId = mention.replace(/<@!?(\d+)>/, '$1');
                            tasks.forEach(taskName => {
                                // Validate task name against the ALLOWED_TASK_NAMES list
                                if (ALLOWED_TASK_NAMES.includes(taskName)) {
                                    if (!helperAssignments[taskName]) {
                                        helperAssignments[taskName] = new Set();
                                    }
                                    helperAssignments[taskName].add(userId);
                                } else {
                                    console.warn(`Attempted to assign points for an unrecognized task: ${taskName}`);
                                    // You might want to reply to the user here as well,
                                    // but it could get spammy if they make many errors.
                                }
                            });
                        });
                    }
                }
            }

            // If there are tagged users (either global or specific tasks) or an attachment, process as completion
            if (hasValidTags || attachment) {
                try {
                    const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);

                    if (expLairChannel && expLairChannel.type === ChannelType.GuildText) {
                        const pointsAwarded = {}; // To store total points awarded per helper
                        let helperSummaries = [];

                        // --- Logic for Global Tagged Users ---
                        if (globalTaggedUsers.size > 0) {
                            let tasksForGlobalAward = [];
                            const initialRequestedTasks = raidInfo.task.toLowerCase().split('+').map(t => t.trim());

                            if (initialRequestedTasks.includes('daily') || initialRequestedTasks.includes('dailies')) {
                                tasksForGlobalAward = DAILIES_LIST.filter(t => t !== 'daily' && t !== 'ultra dailies'); // Exclude generic daily for specific tasks
                            } else if (initialRequestedTasks.includes('weekly') || initialRequestedTasks.includes('weeklies')) {
                                tasksForGlobalAward = WEEKLIES_LIST.filter(t => t !== 'weekly' && t !== 'ultra weeklies'); // Exclude generic weekly for specific tasks
                            } else {
                                tasksForGlobalAward = initialRequestedTasks.filter(task => ALLOWED_TASK_NAMES.includes(task));
                            }

                            let totalPointsForGlobalHelpers = 0;
                            tasksForGlobalAward.forEach(taskName => {
                                totalPointsForGlobalHelpers += POINTS_CONFIG[taskName] || 0;
                            });

                            const helperNames = Array.from(globalTaggedUsers).map(id => `<@${id}>`).join(', ');
                            if (tasksForGlobalAward.length > 0) {
                                helperSummaries.push(`**All Helpers:** ${helperNames} (Total ${totalPointsForGlobalHelpers} EXP each from tasks: ${tasksForGlobalAward.join(', ')})`);
                            } else {
                                helperSummaries.push(`**All Helpers:** ${helperNames} (No specific tasks listed for 'all', defaulting to general request points if applicable)`);
                            }

                            globalTaggedUsers.forEach(userId => {
                                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
                            });
                        }

                        // Process specific task assignments (applied IN ADDITION to 'all' if present)
                        for (const taskName in helperAssignments) {
                            const usersForTask = Array.from(helperAssignments[taskName]);
                            if (usersForTask.length > 0) {
                                const taskPoints = POINTS_CONFIG[taskName] || 0;
                                const helperNames = usersForTask.map(id => `<@${id}>`).join(', ');
                                helperSummaries.push(`**${taskName}:** ${helperNames} (${taskPoints} EXP each)`);
                                usersForTask.forEach(userId => {
                                    pointsAwarded[userId] = (pointsAwarded[userId] || 0) + taskPoints;
                                });
                            }
                        }

                        if (Object.keys(helperAssignments).length === 0 && globalTaggedUsers.size === 0) {
                            await message.reply('No valid helpers or tasks were specified. Please tag helpers for specific tasks (e.g., `daily = @user1`) or for all tasks (`all = @user1`). You can also just type "done" to close the thread without awarding points.');
                            return;
                        }

                        // --- NEW: Prepare the helpers string for the embed ---
                        const allHelperIds = Object.keys(pointsAwarded);
                        const helpersString = allHelperIds.length > 0 ? allHelperIds.map(id => `<@${id}>`).join(' ') : 'None';

                        // --- MODIFIED: Added helpersString to the description ---
                        const embed = new EmbedBuilder()
                            .setColor(0x0099ff)
                            .setTitle(`Raid Completed by ${message.author.username}`)
                            .setDescription(
                                `Raid requested by: <@${raidInfo.requesterId}>\n` +
                                `Task(s): ${raidInfo.task}\n` +
                                `Helpers: ${helpersString}`
                            )
                            .setTimestamp()
                            .setFooter({ text: 'Raid Completion Report' });

                        if (attachment) {
                            embed.setImage(attachment.url);
                        }

                        const sentExpLairMessage = await expLairChannel.send({
                            content: `**Raid Completed!**`,
                            embeds: [embed]
                        });

                        const expLairThread = await sentExpLairMessage.startThread({
                            name: `COMPLETED-${raidInfo.task}-${message.author.username}'s-Raid`,
                            autoArchiveDuration: 60,
                            reason: `Completion details for raid from ${message.author.tag}`,
                        });
                                          
                        let expLairThreadContent = `
                            This thread contains the full details for the completed raid by <@${raidInfo.requesterId}> from <#${originalRaidLogThread.id}>.\n\n` +
                            `**Task Initially Requested:** ${raidInfo.task}\n` +
                            `**Points Breakdown:**\n`;

                        for (const userId in pointsAwarded) {
                            expLairThreadContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
                        }

                        expLairThreadContent += `\n**Helper Assignments Breakdown:**\n${helperSummaries.join('\n')}`;

                        await expLairThread.send({
                            content: expLairThreadContent
                        });

                        // Award points to helpers
                        for (const userId in pointsAwarded) {
                            await updateLeaderboard(userId, pointsAwarded[userId]);
                            console.log(`Awarded ${pointsAwarded[userId]} EXP to user ${userId}.`);
                        }

                        await message.reply('This raid has been closed and the results have been posted to #exp-lair A new thread has been created there for more details.');
                        delete activeRaidThreads[threadId]; // Remove from active threads
                        await originalRaidLogThread.setLocked(true); // Lock the original raid log thread

                    } else {
                        console.error('EXP Lair channel not found or is not a text channel.');
                        await message.reply('Error: Could not find the designated EXP Lair channel or it is not a text channel. Please inform an admin.');
                    }
                } catch (error) {
                    console.error('Error processing raid completion:', error);
                    await message.reply('There was an error processing the raid completion.');
                }
            } else {
                // If message was sent by requester but no tags/screenshot, remind them
                await message.reply('To close the raid, please specify helpers for tasks (e.g., `daily = @user1`) or for all tasks (`all = @user1`), and include a screenshot. You can use `Task1 + Task2 = @user` for multiple tasks. If there are no helpers or screenshots, you can just type "done" to close the thread without awarding points.');
            }
        }
    });

    // --- Interaction Create Listener (for closeRaidTicket button) ---
    client.on('interactionCreate', async interaction => {
        if (interaction.isButton()) {
            if (interaction.customId === 'closeRaidTicket') {
                if (!interaction.channel.isThread()) {
                    await interaction.reply({ content: 'This button can only be used in a raid request thread.', ephemeral: true });
                    return;
                }

                const raidInfo = activeRaidThreads[interaction.channel.id];
                if (raidInfo && interaction.user.id !== raidInfo.requesterId) {
                    await interaction.reply({ content: 'Only the user who initiated this raid request can close it.', ephemeral: true });
                    return;
                }

                await interaction.deferReply({ ephemeral: true });

                const threadId = interaction.channel.id;

                // If raidInfo doesn't exist (e.g., bot restarted), try to infer from thread name
                if (!raidInfo) {
                    const threadName = interaction.channel.name.toLowerCase();
                    let taskFromThread = 'unknown'; // Default to unknown if not explicitly found

                    // Iterate through ALLOWED_TASK_NAMES to find a match in thread name
                    for (const allowedTask of ALLOWED_TASK_NAMES) {
                        if (threadName.includes(allowedTask.toLowerCase())) {
                            taskFromThread = allowedTask;
                            break;
                        }
                    }

                    // Re-initialize activeRaidThreads entry if it was lost
                    activeRaidThreads[threadId] = {
                        task: taskFromThread,
                        requesterId: interaction.user.id,
                        mapName: 'N/A', // Cannot retrieve these from thread name alone without more parsing
                        server: 'N/A',
                        description: 'N/A',
                    };
                }

                activeRaidThreads[threadId].awaitingCompletion = true;
                console.log(`Thread ${threadId} now awaiting completion details.`);

                await interaction.editReply({ content: 'Please specify helpers for tasks (e.g., `daily = @user1 @user2`) or for all tasks (`all = @user1 @user2`), and include a screenshot. You can use `Task1 + Task2 = @user` for multiple tasks. If there are no helpers or screenshots, you can just type "done" to close the thread.', ephemeral: false });
            }
        }
    });
}