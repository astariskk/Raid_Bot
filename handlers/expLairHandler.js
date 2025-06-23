// handlers/expLairHandler.js
import {
    EmbedBuilder,
    ChannelType
} from 'discord.js';
import {
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    ALLOWED_TASK_NAMES
} from '../config/constants.js';
import { updateLeaderboard } from '../utils/fileOps.js';
// --- MODIFIED: Import from the new shared state file ---
import { activeRaidThreads, updateRaidStatus } from './sharedState.js';


export function setupExpLairHandlers(client) {
    // --- Message Create Listener (for handling completion messages in raid threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && raidInfo.awaitingCompletion && message.author.id === raidInfo.requesterId) {
            const threadId = message.channel.id;
            const originalRaidLogThread = message.channel;

            const attachment = message.attachments.first();
            const contentLower = message.content.toLowerCase().trim();

            if (contentLower === 'cancel' && message.mentions.users.size === 0 && !attachment) {
                await message.reply('Raid thread closed without helpers/screenshot. Thread locked.');
                
                // --- NEW: Update status to Done when closing without points ---
                await updateRaidStatus(client, threadId, '❌ Cancelled', 0xFF4500); // red for cancelled

                delete activeRaidThreads[threadId];
                await originalRaidLogThread.setLocked(true);
                return;
            }
            
            // (The entire parsing logic for helpers and tasks remains the same)
            const helperAssignments = {};
            let globalTaggedUsers = new Set();
            let hasValidTags = false;
            const lines = message.content.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;
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
                    continue;
                }
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
                                if (ALLOWED_TASK_NAMES.includes(taskName)) {
                                    if (!helperAssignments[taskName]) {
                                        helperAssignments[taskName] = new Set();
                                    }
                                    helperAssignments[taskName].add(userId);
                                } else {
                                    console.warn(`Unrecognized task: ${taskName}`);
                                }
                            });
                        });
                    }
                }
            }

            if (hasValidTags || attachment) {
            await updateRaidStatus(client, threadId, '✅ Done', 0x57F287); // Green for done              
                try {
                    const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);
                    if (expLairChannel && expLairChannel.type === ChannelType.GuildText) {
                        const pointsAwarded = {};
                        let helperSummaries = [];
                        
                        // --- FIX: Logic to correctly accumulate points for `all` helpers ---
                        if (globalTaggedUsers.size > 0) {
                            let tasksForGlobalAward = [];
                            const initialRequestedTasks = raidInfo.task.toLowerCase().split('+').map(t => t.trim());
                            let containsMetaTask = false;

                            // Accumulate daily tasks if requested
                            if (initialRequestedTasks.includes('daily') || initialRequestedTasks.includes('dailies')) {
                                tasksForGlobalAward.push(...DAILIES_LIST.filter(t => t !== 'daily' && t !== 'dailies'));
                                containsMetaTask = true;
                            }
                            
                            // Accumulate weekly tasks if requested
                            if (initialRequestedTasks.includes('weekly') || initialRequestedTasks.includes('weeklies')) {
                                tasksForGlobalAward.push(...WEEKLIES_LIST.filter(t => t !== 'weekly' && t !== 'weeklies'));
                                containsMetaTask = true;
                            }

                            // If no meta tasks were in the request, use the original tasks
                            if (!containsMetaTask) {
                                tasksForGlobalAward = initialRequestedTasks.filter(task => ALLOWED_TASK_NAMES.includes(task));
                            }
                            
                            let totalPointsForGlobalHelpers = 0;
                            tasksForGlobalAward.forEach(taskName => {
                                totalPointsForGlobalHelpers += POINTS_CONFIG[taskName] || 0;
                            });

                            const helperNames = Array.from(globalTaggedUsers).map(id => `<@${id}>`).join(', ');
                            if (tasksForGlobalAward.length > 0) {
                                // Make the summary more readable by referencing the original request
                                helperSummaries.push(`**All Helpers:** ${helperNames} (Total ${totalPointsForGlobalHelpers} EXP each from tasks: ${raidInfo.task})`);
                            } else {
                                helperSummaries.push(`**All Helpers:** ${helperNames} (No specific tasks listed for 'all')`);
                            }

                            globalTaggedUsers.forEach(userId => {
                                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForGlobalHelpers;
                            });
                        }

                        // --- FIX: Logic to handle meta-tasks (daily/weekly) for specific assignments ---
                        for (const taskName in helperAssignments) {
                            const usersForTask = Array.from(helperAssignments[taskName]);
                            if (usersForTask.length === 0) continue;
                        
                            let totalPointsForTask = 0;
                            let awardedTasksSummary = [taskName]; // Default summary
                        
                            // Check if the assigned task is a meta-task and calculate total points accordingly
                            if (taskName === 'daily' || taskName === 'dailies') {
                                const dailyTasks = DAILIES_LIST.filter(t => t !== 'daily' && t !== 'dailies');
                                totalPointsForTask = dailyTasks.reduce((sum, t) => sum + (POINTS_CONFIG[t] || 0), 0);
                                awardedTasksSummary = dailyTasks;
                            } else if (taskName === 'weekly' || taskName === 'weeklies') {
                                const weeklyTasks = WEEKLIES_LIST.filter(t => t !== 'weekly' && t !== 'weeklies');
                                totalPointsForTask = weeklyTasks.reduce((sum, t) => sum + (POINTS_CONFIG[t] || 0), 0);
                                awardedTasksSummary = weeklyTasks;
                            } else {
                                // It's a single, regular task
                                totalPointsForTask = POINTS_CONFIG[taskName] || 0;
                            }
                        
                            if (totalPointsForTask > 0) {
                                const helperNames = usersForTask.map(id => `<@${id}>`).join(', ');
                                helperSummaries.push(`**${taskName.toUpperCase()}:** ${helperNames} (${totalPointsForTask} EXP each)`);
                                
                                usersForTask.forEach(userId => {
                                    // Avoid double-counting if user is in 'all' and a specific task
                                    if (!globalTaggedUsers.has(userId)) {
                                        pointsAwarded[userId] = (pointsAwarded[userId] || 0) + totalPointsForTask;
                                    }
                                });
                            }
                        }

                        if (Object.keys(pointsAwarded).length === 0) {
                               await message.reply('No valid helpers or tasks specified. Please tag helpers or type "cancel" to close without helpers.');
                               return;
                        }
                        
                        const allHelperIds = Object.keys(pointsAwarded);
                        const helpersString = allHelperIds.length > 0 ? allHelperIds.map(id => `<@${id}>`).join(' ') : 'None';
                        
                        const embed = new EmbedBuilder()
                            .setColor(0x0099ff)
                            .setTitle(`Raid Completed by ${message.author.username}`)
                            .setDescription(`Raid requested by: <@${raidInfo.requesterId}>\nTask(s): ${raidInfo.task}\nHelpers: ${helpersString}`)
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
                            autoArchiveDuration: 60
                        });
                        
                        let expLairThreadContent = `
                            This thread contains the full details for the completed raid by <@${raidInfo.requesterId}> from <#${originalRaidLogThread.id}>.\n\n` +
                            `**Task Initially Requested:** ${raidInfo.task}\n` +
                            `**Points Breakdown:**\n`;

                        for (const userId in pointsAwarded) {
                            expLairThreadContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
                        }

                        expLairThreadContent += `\n**Helper Assignments Breakdown:**\n${helperSummaries.join('\n')}`;

                        await expLairThread.send({ content: expLairThreadContent });

                        for (const userId in pointsAwarded) {
                            await updateLeaderboard(userId, pointsAwarded[userId]);
                        }
                        
                        await message.reply('Raid closure details posted and points awarded!');

                        delete activeRaidThreads[threadId];
                        await originalRaidLogThread.setLocked(true);
                        await originalRaidLogThread.send('This raid thread is now complete and locked.');

                    }
                } catch (error) {
                    console.error('Error processing raid completion:', error);
                    await message.reply('There was an error processing the raid completion.');
                }
            } else {
                 await message.reply('To close the raid, please specify helpers for tasks (e.g., `daily = @user1`), and include a screenshot. Or type "cancel" to close without helpers.');
            }
        }
    });

    // --- Interaction Create Listener (for closeRaidTicket button) ---
    client.on('interactionCreate', async interaction => {
        if (interaction.isButton()) {
            if (interaction.customId === 'closeRaidTicket') {
                if (!interaction.channel.isThread()) return;

                const raidInfo = activeRaidThreads[interaction.channel.id];
                if (raidInfo && interaction.user.id !== raidInfo.requesterId) {
                    await interaction.reply({ content: 'Only the user who initiated this raid can close it.', ephemeral: true });
                    return;
                }

                await interaction.deferReply({ ephemeral: true });

                const threadId = interaction.channel.id;
                
                // (Logic to re-initialize raidInfo if bot restarted remains the same)
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

                await interaction.editReply({ content: 'Please specify helpers (e.g., `daily = @user1 @user2`), and include a screenshot. Or type "cancel" to close the thread.', ephemeral: false });
            }
        }
    });
}
