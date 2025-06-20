// handlers/raidHandler.js
import {
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    TextChannel,
    EmbedBuilder,
    ChannelType
} from 'discord.js';
import {
    RAID_CHANNEL_ID,
    RAID_LOGS_CHANNEL_ID,
    EXP_LAIR_CHANNEL_ID,
    POINTS_CONFIG,
    RAID_HELPER_ROLE_ID
} from '../index.js';
import { updateLeaderboard } from '../utils/fileOps.js';

export const activeRaidThreads = {}; // Maps thread ID to an object containing { task: 'weekly', requesterId: 'userId', awaitingCompletion: true/false }

// --- Allowed Task Names ---
// This list should ideally be kept in sync with POINTS_CONFIG keys for validity.
const ALLOWED_TASK_NAMES = [
    'nulgath', 'drakath', 'dage', 'darkon', 'drago', 'speaker', 'ezrajal', 'warden',
    'engineer', 'tyndarius', 'daily', 'weekly', 'ultra dailies', 'ultra weeklies' // Added common ones
];

// --- Button Definitions ---
const helpButton = new ButtonBuilder()
    .setCustomId("showHelpModal")
    .setLabel('Help')
    .setStyle(ButtonStyle.Primary);

const helpButtonRow = new ActionRowBuilder()
    .addComponents(helpButton);

const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('Close Raid')
    .setStyle(ButtonStyle.Danger);

const closeTicketButtonRow = new ActionRowBuilder()
    .addComponents(closeTicketButton);

export function setupRaidHandlers(client) {
    // --- Message Create Listener (for !raidhelp command and closing logic in threads) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots

        // Command to send the initial Help button in the designated raid channel
        if (message.channel.id === RAID_CHANNEL_ID && message.content === '!raidhelp') {
            try {
                await message.channel.send({
                    content: 'Click the button below to request raid assistance:',
                    components: [helpButtonRow]
                });
            } catch (error) {
                console.error('Error sending help button message:', error);
            }
        }

        // --- Handle Helper Tags and Screenshot in Raid Threads ---
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

            // --- New logic for parsing helper tags and tasks ---
            const helperAssignments = {};
            let globalTaggedUsers = new Set();
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

                        let descriptionDetails = `Raid requested by: <@${raidInfo.requesterId}>\n`;
                        descriptionDetails += `Task initially requested: ${raidInfo.task}\n\n`;

                        let helperSummaries = [];

                        // Process global tagged users
                        if (globalTaggedUsers.size > 0) {
                            // Ensure raidInfo.task is also a recognized task for points
                            const mainTaskPoints = POINTS_CONFIG[raidInfo.task] || 0;
                            const helperNames = Array.from(globalTaggedUsers).map(id => `<@${id}>`).join(', ');
                            helperSummaries.push(`**All Helpers (${raidInfo.task.toUpperCase()}):** ${helperNames} (${mainTaskPoints} EXP each)`);
                            globalTaggedUsers.forEach(userId => {
                                pointsAwarded[userId] = (pointsAwarded[userId] || 0) + mainTaskPoints;
                            });
                        }

                        // Process specific task assignments
                        for (const taskName in helperAssignments) {
                            const usersForTask = Array.from(helperAssignments[taskName]);
                            if (usersForTask.length > 0) {
                                const taskPoints = POINTS_CONFIG[taskName] || 0; // Get points for the specific task
                                const helperNames = usersForTask.map(id => `<@${id}>`).join(', ');
                                helperSummaries.push(`**${taskName.toUpperCase()}:** ${helperNames} (${taskPoints} EXP each)`);
                                usersForTask.forEach(userId => {
                                    pointsAwarded[userId] = (pointsAwarded[userId] || 0) + taskPoints;
                                });
                            }
                        }

                        if (Object.keys(helperAssignments).length === 0 && globalTaggedUsers.size === 0) {
                            await message.reply('No valid helpers or tasks were specified. Please tag helpers for specific tasks (e.g., `daily = @user1`) or for all tasks (`all = @user1`). You can also just type "done" to close the thread without awarding points.');
                            return;
                        }

                        descriptionDetails += helperSummaries.join('\n\n');

                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00) // Green color
                            .setTitle(`Raid Completed Report`)
                            .setDescription(descriptionDetails)
                            .setTimestamp()
                            .setFooter({ text: 'Raid Completion Report' });

                        if (attachment) {
                            embed.setImage(attachment.url); // Set the screenshot as embed image
                            embed.setDescription(embed.data.description + `\n\n**Screenshot:** (See attached image)`);
                        }

                        // Send the message to exp-lair
                        const sentExpLairMessage = await expLairChannel.send({
                            content: `**Raid Completed!** Raid requested by <@${raidInfo.requesterId}>. Details below:`,
                            embeds: [embed]
                        });

                        // Create a thread under the message in exp-lair
                        const expLairThread = await sentExpLairMessage.startThread({
                            name: `COMPLETED-${raidInfo.task}-${message.author.username}'s-Raid`,
                            autoArchiveDuration: 60, // Archive after 60 minutes of inactivity
                            reason: `Completion details for raid from ${message.author.tag}`,
                        });

                        // Send extra info into the new thread in exp-lair
                        let expLairThreadContent = `This thread contains the full details for the completed raid by <@${raidInfo.requesterId}>.\n\n` +
                            `**Task Initially Requested:** ${raidInfo.task}\n` +
                            `**Map Name:** ${raidInfo.mapName || 'N/A'}\n` +
                            `**Server:** ${raidInfo.server || 'N/A'}\n` +
                            `**Description:** ${raidInfo.description || 'No description provided.'}\n\n` +
                            `**Points Breakdown:**\n`;

                        for (const userId in pointsAwarded) {
                            expLairThreadContent += `<@${userId}>: ${pointsAwarded[userId]} EXP\n`;
                        }
                        expLairThreadContent += `\n(Original request thread: <#${originalRaidLogThread.id}>)`;

                        await expLairThread.send({
                            content: expLairThreadContent
                        });

                        // Award points to helpers
                        for (const userId in pointsAwarded) {
                            await updateLeaderboard(userId, pointsAwarded[userId]);
                            console.log(`Awarded ${pointsAwarded[userId]} EXP to user ${userId}.`);
                        }

                        await message.reply('Your raid closure details have been posted to #exp-lair and points awarded! A new thread has been created there for these details.');
                        delete activeRaidThreads[threadId]; // Remove from active threads
                        await originalRaidLogThread.setLocked(true); // Lock the original raid log thread
                        await originalRaidLogThread.send('This raid thread has been locked as it is now complete. A new request can be started using `!raidhelp` in the raid channel.');

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

    // --- Interaction Create Listener (for button clicks and modal submissions) ---
    client.on('interactionCreate', async interaction => {
        // --- Handle Button Interactions ---
        if (interaction.isButton()) {
            if (interaction.customId === 'showHelpModal') {
                const modal = new ModalBuilder()
                    .setCustomId('raidRequestModal')
                    .setTitle('Raid Assistance Request');

                const taskInput = new TextInputBuilder()
                    .setCustomId('taskInput')
                    .setLabel("Task (see !raidlist for all options)") // New label text
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    // **MODIFIED LINE HERE**
                    .setPlaceholder(`Enter task(s) like 'daily' or 'daily+weekly'`);

                const mapNameInput = new TextInputBuilder()
                    .setCustomId('mapNameInput')
                    .setLabel("Map Name")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('e.g., Underworld, Skybreak, etc.');

                const serverInput = new TextInputBuilder()
                    .setCustomId('serverInput')
                    .setLabel("Server (e.g., NA, EU, Asia)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('e.g., NA, EU, Asia');

                const descriptionInput = new TextInputBuilder()
                    .setCustomId('descriptionInput')
                    .setLabel("Description/Notes")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Any specific details or requirements?');

                const firstActionRow = new ActionRowBuilder().addComponents(taskInput);
                const secondActionRow = new ActionRowBuilder().addComponents(mapNameInput);
                const thirdActionRow = new ActionRowBuilder().addComponents(serverInput);
                const fourthActionRow = new ActionRowBuilder().addComponents(descriptionInput);

                modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);

                await interaction.showModal(modal);
            } else if (interaction.customId === 'closeRaidTicket') {
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

                    activeRaidThreads[threadId] = {
                        task: taskFromThread,
                        requesterId: interaction.user.id,
                        mapName: 'N/A',
                        server: 'N/A',
                        description: 'N/A',
                    };
                }

                activeRaidThreads[threadId].awaitingCompletion = true;
                console.log(`Thread ${threadId} now awaiting completion details.`);

                await interaction.editReply({ content: 'Please specify helpers for tasks (e.g., `daily = @user1 @user2`) or for all tasks (`all = @user1 @user2`), and include a screenshot. You can use `Task1 + Task2 = @user` for multiple tasks. If there are no helpers or screenshots, you can just type "done" to close the thread.', ephemeral: false });
            }
        }

        // --- Handle Modal Submissions ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') {
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                await interaction.deferReply({ ephemeral: true });

                // Validate all tasks requested in the modal input
                const requestedTasks = task.split('+').map(t => t.trim());
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) { // Using the new array
                        await interaction.editReply({ content: `Invalid task "${singleTask}". Please use one of: ${ALLOWED_TASK_NAMES.join(', ')}. If requesting multiple, separate with '+'.`, ephemeral: true });
                        return;
                    }
                }

                try {
                    const raidLogsChannel = await client.channels.fetch(RAID_LOGS_CHANNEL_ID);

                    if (raidLogsChannel instanceof TextChannel) {
                        const embedMessage = new EmbedBuilder()
                            .setColor(0x0099ff)
                            .setTitle(`New Raid Request: ${task}`)
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                            .addFields(
                                { name: 'Requested By', value: `<@${interaction.user.id}>` },
                                { name: 'Task(s)', value: task, inline: true },
                                { name: 'Map Name', value: mapName, inline: true },
                                { name: 'Server', value: server, inline: true },
                                { name: 'Description', value: description || 'No description provided.' },
                            )
                            .setTimestamp()
                            .setFooter({ text: 'Raid Request System' });

                        const sentMessage = await raidLogsChannel.send({
                            embeds: [embedMessage],
                            content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}!`,
                        });

                        const thread = await sentMessage.startThread({
                            name: `${task} | ${mapName} | ${server} | ${interaction.user.username}`,
                            autoArchiveDuration: 60,
                            reason: `Raid request from ${interaction.user.tag}`,
                        });

                        await thread.send({
                            content: `Discuss details here!\n\nClick the button below once the raid is complete to close the ticket and award points:`,
                            components: [closeTicketButtonRow]
                        });

                        activeRaidThreads[thread.id] = {
                            task: task,
                            requesterId: interaction.user.id,
                            mapName: mapName,
                            server: server,
                            description: description,
                            awaitingCompletion: false
                        };
                        console.log(`Active raid thread created: ${thread.id} for task ${task} by ${interaction.user.tag}`);

                        await interaction.editReply({ content: 'Your raid request has been submitted and a thread has been created in the logs channel!', ephemeral: true });

                    } else {
                        console.error('Raid logs channel is not a text channel:', RAID_LOGS_CHANNEL_ID);
                        await interaction.editReply({ content: 'Error: Could not find the designated raid logs channel or it is not a text channel.', ephemeral: true });
                    }

                } catch (error) {
                    console.error('Error handling modal submission or creating thread:', error);
                    await interaction.editReply({ content: 'There was an error processing your raid request.', ephemeral: true });
                }
            }
        }
    });
}