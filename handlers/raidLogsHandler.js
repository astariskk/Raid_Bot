// handlers/raidLogsHandler.js
// This file contains handlers for creating raid requests, managing raid status updates,
// displaying boss mechanics charts within raid threads, and showing raid task EXP points.

// Import necessary Discord.js components for UI elements like buttons, modals, embeds.
import {
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    TextChannel, // Used for type checking Discord channels
    EmbedBuilder
} from 'discord.js';

// Import constants related to channel IDs, role IDs, task lists, and points configuration
import {
    RAID_CHANNEL_ID,
    RAID_LOGS_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    DAILIES_LIST,
    WEEKLIES_LIST,
    OTHERS_FOUR_LIST,
    OTHERS_SEVEN_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    ALLOWED_TASK_NAMES,
    POINTS_CONFIG,
    GENERIC_TASKS_LIST,
    TASK_MAP_CATEGORIES,
    TASK_TO_MAP_PREFIX_MAPPING,

    // role IDs for admin status check
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_CHAMPION_ROLE_ID,
    RECORD_HOLDER_ROLE_ID
} from '../config/constants.js';

// Import shared state and functions from activeRaidState.js for managing active raid threads.
import { activeRaidThreads, updateRaidStatus } from '../activeRaidState.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsHandler.js';

// --- Utility Functions ---
/**
 * Checks if a message author has an admin role.
 * @param {import('discord.js').Message} message The message to check.
 * @returns {boolean} True if the user has an admin role, false otherwise.
 */
function isAdmin(message) {
    if (!message.member) {
        console.warn('isAdmin called for a message without a member object (e.g., DM).');
        return false;
    }
    return (
        message.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        message.member.roles.cache.has(OFFICER_ROLE_ID) ||
        message.member.roles.cache.has(RAID_MANAGER_ROLE_ID) ||
        message.member.roles.cache.has(RAID_CHAMPION_ROLE_ID) ||
        message.member.roles.cache.has(RECORD_HOLDER_ROLE_ID)
    );
}

// Button to close a raid ticket/thread.
const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

// Button to edit the tasks associated with a raid.
const editTaskButton = new ButtonBuilder()
    .setCustomId("editTask_btn")
    .setLabel('✏️ Edit Task')
    .setStyle(ButtonStyle.Secondary);


const threadActionRow = new ActionRowBuilder()
    .addComponents(closeTicketButton, editTaskButton);


/**
 * Creates and returns the Modal for submitting new raid assistance requests.
 * This modal collects essential information from the user for a new raid.
 * @returns {ModalBuilder} The modal for raid requests.
 */
export function getRaidRequestModal() {
    const modal = new ModalBuilder()
        .setCustomId('raidRequestModal') // Unique ID for this modal.
        .setTitle('Raid Assistance Request'); // Title of the modal.

    // Input field for the task(s).
    const taskInput = new TextInputBuilder()
        .setCustomId('taskInput')
        .setLabel("Task(s) (!raidtasks for options): ")
        .setStyle(TextInputStyle.Short) // Short text input.
        .setRequired(true) // Required field.
        .setPlaceholder(`Enter task(s) like 'daily' or 'nulgath + drakath'`);

    // Input field for the map name.
    const mapNameInput = new TextInputBuilder()
        .setCustomId('mapNameInput')
        .setLabel("Map Name: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., ultraspeaker, championdrakath, etc.');

    // Input field for the server.
    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel("Server: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria');

    // Input field for description/notes.
    const descriptionInput = new TextInputBuilder()
        .setCustomId('descriptionInput')
        .setLabel("Description/Notes")
        .setStyle(TextInputStyle.Paragraph) // Paragraph style for multi-line input.
        .setRequired(false) // Optional field.
        .setPlaceholder('Any specific details or requirements?');

    // Action rows to contain each text input component.
    const firstActionRow = new ActionRowBuilder().addComponents(taskInput);
    const secondActionRow = new ActionRowBuilder().addComponents(mapNameInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(serverInput);
    const fourthActionRow = new ActionRowBuilder().addComponents(descriptionInput);

    // Add all action rows to the modal.
    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);
    return modal;
}

/**
 * Sets up event handlers for raid logging functionalities, including raid requests,
 * status updates within threads, and boss mechanic charts in threads.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export function setupRaidLogsHandlers(client) {
    // --- Message Create Listener (for commands and status updates within threads) ---
    // This listener processes messages sent in any channel.
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots to prevent infinite loops.

        // --- Logic for status updates within active raid threads ---
        // Check if the message is in an active raid thread and sent by the raid requester OR an admin.
        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && (message.author.id === raidInfo.requesterId || isAdmin(message))) {
            const content = message.content.toLowerCase().trim(); // Get message content, lowercase and trim.
            let newStatus, newColor;

            // Determine the new status and color based on specific keywords.
            if (content === '!waiting') {
                newStatus = '🔵 Waiting';
                newColor = 0x0099ff; // Blue for waiting.
            } else if (content === '!full') {
                newStatus = '🔴 Full';
                newColor = 0xdd2e44; // Red for full.
            } else if (content === '!ongoing') {
                newStatus = '🟢 Ongoing';
                newColor = 0x78b159; // Lime Green for ongoing.
            }

            // If a new status was determined, update the raid embed and react to the message.
            if (newStatus) {
                await updateRaidStatus(client, message.channel.id, newStatus, newColor);
                await message.react('👍'); // React with a thumbs-up to acknowledge.
                return; // Stop further processing as this message was a status update.
            }
        }

        // --- Logic for boss mechanic charts within any thread ---
        if (message.channel.isThread()) {
            const threadCommand = message.content.toLowerCase().trim();
            let embedToSend;
            let messageContent = null; 

            // Check for specific chart commands and create the corresponding embed.
            if (threadCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg') // Image URL for the chart.
                    .setFooter({ text: 'Speaker chart for 1-man taunts' });
            } else if (threadCommand === '!2man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('2-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/spq6t1.png')
                    .setFooter({ text: 'Speaker chart for 2-man taunts' });
                messageContent = "It's movie time <@114514543899705351>";        //ping Veritus            
            } else if (threadCommand === '!3man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('3-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/5x4grv.jpg')
                    .setFooter({ text: 'Speaker chart for 3-man taunts' });
            } else if (threadCommand === '!4man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('4-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/yi71zh.jpg')
                    .setFooter({ text: 'Speaker chart for 4-man taunts' });
            } else if (threadCommand === '!gramielchart') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('Gramiel Chart')
                    .setImage('https://files.catbox.moe/esowjk.png')
                    .setFooter({ text: 'Gramiel chart made by Lilicht' });
            }

            // If a chart embed was created, send it to the thread.
            if (embedToSend) {
                try {
                    await message.channel.send({ content: messageContent, embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending ${threadCommand} chart:`, error);
                    await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                }
            }
        }

        // --- Handle !raidmaps without a number ---
        if (message.content.toLowerCase().trim() === '!raidmaps') {
            if (message.channel.isThread()) {
                await message.channel.send('Please provide the map number. Example: `!raidmaps 7070`');
            } else {
                await message.channel.send('The `!raidmaps [number]` command can only be used inside an active raid thread to get join links for the tasks in that specific raid.');
            }
            return;
        }

        // --- Handle the !raidmaps <number> command ---
        const raidMapsMatch = message.content.toLowerCase().match(/^!raidmaps\s+(\d+)$/);

        if (raidMapsMatch) {
            const mapNumber = raidMapsMatch[1]; // Extract the number

            // Check if the command is used within an active raid thread
            const raidInfo = activeRaidThreads[message.channel.id];

            if (message.channel.isThread() && raidInfo) {
                const raidTasksString = raidInfo.task; // Get the task string from the active raid info
                // Split tasks by '+' to handle multiple tasks (e.g., 'task1 + task2').
                const rawRequestedTasks = raidTasksString.split(/\s*\+\s*/).map(t => t.trim());

                let expandedTasks = [];
                // Expand meta-tasks into their individual components
                for (const task of rawRequestedTasks) {
                    if (TASK_MAP_CATEGORIES[task]) {
                        // If it's a category (like 'daily' or 'weekly'), add its individual tasks
                        expandedTasks = expandedTasks.concat(TASK_MAP_CATEGORIES[task]);
                    } else {
                        expandedTasks.push(task);
                    }
                }

                // Generate the /join links for each task
                const joinLinksWithPoints = expandedTasks.map(task => {
                    const mapPrefix = TASK_TO_MAP_PREFIX_MAPPING[task] || task;
                    return `* /join ${mapPrefix}-${mapNumber}`;
                }).join('\n');

                const embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`Raid Maps for Current Task(s): ${raidTasksString}`)
                    .setDescription(`Here are the join commands for your current raid task(s) with the room number ${mapNumber}:\n\n${joinLinksWithPoints}`)
                    .setFooter({ text: 'Use these commands to join the maps!' });

                try {
                    await message.channel.send({ embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending !raidmaps for thread ${message.channel.id}:`, error);
                    await message.channel.send('Failed to display raid maps for this thread. Please try again later.');
                }
            } else {
                // If not in an active raid thread, inform the user about correct usage
                await message.channel.send(
                    'The `!raidmaps [number]` command can only be used inside an active raid thread ' +
                    'to get join links for the tasks in that specific raid.'
                );
            }
            return;
        }
        // --- Handle the !raidsite command ---
        if (message.content.toLowerCase() === '!raidsite') {
            const raidSiteButton = new ButtonBuilder()
                .setLabel('Go to Raid Map Tool')
                .setStyle(ButtonStyle.Link)
                .setURL('https://neiru.vercel.app/aqw/raid/maps');

            const raidSiteRow = new ActionRowBuilder().addComponents(raidSiteButton);

            try {
                await message.channel.send({
                    content: 'Click the button below for a tool that makes joining maps easier.',
                    components: [raidSiteRow]
                });
            } catch (error) {
                console.error('Error sending !!raidsite embed:', error);
                await message.channel.send('Failed to display raid site. Please try again later.');
            }
        }

        // --- Command to list all available raid tasks with their points ---
        if (message.content.toLowerCase() === '!raidtasks') {
            try {
                await message.channel.send({ embeds: [getCombinedTasksAndPointsEmbed()] });
            } catch (error) {
                console.error('Error sending !raidtasks message:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
        }
    });

    // --- Interaction Create Listener (for button clicks and modal submissions) ---
    // This listener processes interactions (button clicks, modal submissions, etc.).
    client.on('interactionCreate', async interaction => {
        // Only process buttons and modal submissions in this handler.
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        // --- Handle Modal Submissions ---
        if (interaction.isModalSubmit()) {
            // Check if the submitted modal is the 'raidRequestModal'.
            if (interaction.customId === 'raidRequestModal') {
                // Extract values from the modal's input fields.
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                // Removed deferReply, will use direct reply

                // Split tasks by '+' to handle multiple tasks (e.g., 'task1 + task2').
                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                // Validate each individual task against allowed task names.
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) { // Removed custom task prefix check
                        // If an invalid task is found, send an error reply with the tasks embed.
                        await interaction.reply({ // Changed from editReply to reply
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                            embeds: [getCombinedTasksAndPointsEmbed()],
                            ephemeral: true
                        });
                        return; // Stop processing if validation fails.
                    }
                }

                try {
                    const raidLogsChannel = await client.channels.fetch(RAID_LOGS_CHANNEL_ID);

                    // Ensure the fetched channel is a text channel before sending messages.
                    if (raidLogsChannel instanceof TextChannel) {
                        // Create the embed message for the new raid request.
                        const embedMessage = new EmbedBuilder()
                            .setColor(0x0099ff) // Blue color.
                            .setTitle(`New Raid Request by: ${interaction.member.displayName}`) // Title with the user's name.
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }) // Set author as the requesting user.
                            .addFields(
                                { name: 'Task(s)', value: task, inline: false },
                                { name: 'Map Name', value: mapName, inline: true }, 
                                { name: 'Server', value: server, inline: true },   
                                { name: 'Status', value: '🔵 Waiting', inline: true }, // Initial status.
                                { name: 'Description', value: description || 'No description provided.' },
                            )
                            .setTimestamp() // Timestamp for when the request was made.
                            .setFooter({ text: 'Raid Request System' });

                        // Send the embed message to the raid logs channel, tagging the Raid Helper role.
                        const sentMessage = await raidLogsChannel.send({
                            embeds: [embedMessage],
                            content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}!`,
                        });

                        // Create a thread name player's raid request. and below 100 characters.
                        const fullThreadName = `${interaction.member.displayName}'s Raid Request`;
                        const threadName = fullThreadName.length > 99 ? fullThreadName.substring(0, 99) : fullThreadName;


                        // Start a new thread off the sent message for discussion.
                        const thread = await sentMessage.startThread({
                            name: threadName, // Use the new, validated name.
                            autoArchiveDuration: 60, // Thread auto-archives after 60 minutes of inactivity.
                            reason: `Raid request from ${interaction.user.tag}`,
                        });

                        await thread.send({
                            content: `Discuss details here!\n\nTo update the status, the raid requester can type **!waiting**, **!ongoing** or **!full** in this thread.\n\nClick the button below once the raid is complete or to edit tasks:`,
                            components: [threadActionRow] // Attach the close and edit buttons.
                        });

                        // Store the raid's information in the `activeRaidThreads` shared state.
                        activeRaidThreads[thread.id] = {
                            messageId: sentMessage.id,
                            originalChannelId: raidLogsChannel.id,
                            task: task, // Store the combined task string
                            requesterId: interaction.user.id,
                            mapName: mapName,
                            server: server,
                            description: description,
                            awaitingCompletion: false // Initial state: not awaiting completion.
                        };
                        console.log(`Active raid thread created: ${thread.id} for task ${task} by ${interaction.user.tag}`);

                        // Edit the deferred reply to confirm the raid request submission.
                        await interaction.reply({ content: 'Your raid request has been submitted and a thread has been created!', ephemeral: true }); // Changed from editReply to reply
                    } else {
                        // If the raid logs channel is not a text channel, send an error.
                        await interaction.reply({ content: 'Error: Could not find the raid logs channel or it is not a text channel.', ephemeral: true }); // Changed from editReply to reply
                    }
                } catch (error) {
                    console.error('Error handling modal submission and creating raid:', error);
                    // Provide a user-friendly error message if something goes wrong.
                    await interaction.reply({ content: 'There was an error processing your request and creating the raid. Please try again later.', ephemeral: true }); // Changed from editReply to reply
                }
            }
            // All other modals (like 'editTaskModal') are handled in `expLairHandler.js`.
        }
    });
}
