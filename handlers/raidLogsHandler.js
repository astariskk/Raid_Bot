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
    OTHERS_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    ALLOWED_TASK_NAMES,
    POINTS_CONFIG,
    GENERIC_TASKS_LIST,
    TASK_MAP_CATEGORIES, // Crucial for expanding meta tasks
    TASK_TO_MAP_PREFIX_MAPPING
} from '../config/constants.js';

// Import shared state and functions from activeRaidState.js for managing active raid threads.
import { activeRaidThreads, updateRaidStatus } from '../activeRaidState.js';
// getTasksEmbed is commented out, suggesting it might have been used previously
// or is intended for future use but not directly within this file's current logic.
// import { getTasksEmbed } from './handlers/raidLogsHandler.js'; // This line is self-referential and should be removed if not used elsewhere, but kept original structure.


// --- Button Definitions for initial raid request and closing a thread ---
// These buttons are displayed when a raid thread is initially created.
// `raidLogsHandler` is responsible for sending these buttons.
// The *handling* of clicks on these specific buttons is managed by `expLairHandler` (for close/edit)
// and `generalCommandsHandler` (for the initial raid start button, not defined here but mentioned in logic).

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

// --- Buttons for the `!raidpoints` command embed ---
const dailiesPointsButton = new ButtonBuilder()
    .setCustomId('dailiesPoints_btn')
    .setLabel('Dailies Points')
    .setStyle(ButtonStyle.Primary); // Blue style for primary actions.

const weekliesPointsButton = new ButtonBuilder()
    .setCustomId('weekliesPoints_btn')
    .setLabel('Weeklies Points')
    .setStyle(ButtonStyle.Primary);

const templeshrinePointsButton = new ButtonBuilder()
    .setCustomId('templeshrinePoints_btn')
    .setLabel('TempleShrine Points')
    .setStyle(ButtonStyle.Primary);

const originulPointsButton = new ButtonBuilder()
    .setCustomId('originulPoints_btn')
    .setLabel('Originul Points')
    .setStyle(ButtonStyle.Primary);

const othersPointsButton = new ButtonBuilder()
    .setCustomId('othersPoints_btn')
    .setLabel('Other Tasks Points')
    .setStyle(ButtonStyle.Primary);

const genericTasksPointsButton = new ButtonBuilder()
    .setCustomId('genericTasksPoints_btn')
    .setLabel('Generic Tasks Points')
    .setStyle(ButtonStyle.Primary); 

// Action rows to organize the `!raidpoints` buttons.
const raidPointsButtonsRow1 = new ActionRowBuilder()
    .addComponents(dailiesPointsButton, weekliesPointsButton, templeshrinePointsButton);

const raidPointsButtonsRow2 = new ActionRowBuilder()
    .addComponents(originulPointsButton, othersPointsButton, genericTasksPointsButton);


/**
 * Generates a formatted string of task names and their associated EXP values
 * for a given list of tasks. This is used for displaying points in embeds.
 * @param {string[]} taskList - The list of task names (e.g., DAILIES_LIST).
 * @returns {string} A formatted string, with each task on a new line,
 * e.g., "• `ezrajal` = 200 EXP\n• `warden` = 300 EXP".
 */
function formatTaskListPoints(taskList) {
    if (!taskList || taskList.length === 0) return 'N/A'; // Handle empty or undefined lists.
    // Map each task name to its corresponding points from POINTS_CONFIG and format it.
    return taskList.map(task => `• \`${task}\` = ${POINTS_CONFIG[task] || 0} EXP`).join('\n');
}

/**
 * Creates and returns an EmbedBuilder instance that lists all available raid tasks,
 * categorized for clarity. This embed helps users understand which tasks they can request.
 * @returns {EmbedBuilder} The embed containing raid tasks and their categories.
 */
export function getTasksEmbed() {
    // Format each task list into a comma-separated string of task names enclosed in backticks.
    const dailiesListFormatted = DAILIES_LIST.map(task => `\`${task}\``).join(', ');
    const weekliesListFormatted = WEEKLIES_LIST.map(task => `\`${task}\``).join(', ');
    const othersListFormatted = OTHERS_LIST.map(task => `\`${task}\``).join(', ');
    const templeShrineListFormatted = TEMPLESHRINE_LIST.map(task => `\`${task}\``).join(', ');
    const originulListFormatted = ORIGINUL_LIST.map(task => `\`${task}\``).join(', ');
    const genericTasksListFormatted = GENERIC_TASKS_LIST.map(task => `\`${task}\``).join(', ');

    return new EmbedBuilder()
        .setColor(0x3498DB) // A blue color for informational embeds.
        .setTitle('Available Raid Tasks')
        .setDescription('Note that only words covered in `this` are valid choices. Here are the tasks you can request assistance for:')
        .addFields( // Add fields for each category of tasks.
            { name: '`Weekly` or `Weeklies`', value: weekliesListFormatted || 'N/A' },
            { name: '`Daily` or `Dailies`', value: dailiesListFormatted || 'N/A' },
            { name: '`TempleShrine`', value: templeShrineListFormatted || 'N/A' },
            { name: '`Originul` Dailies:', value: originulListFormatted || 'N/A' },
            { name: 'Other Tasks', value: othersListFormatted || 'N/A' },
            { name: 'Generic Tasks', value: genericTasksListFormatted || 'N/A' }
            // Removed "Custom Tasks" field as custom task handling is no longer enabled.
        )
        .setFooter({ text: 'Use these names in your raid requests!' });
}

/**
 * Creates and returns the initial Embed for raid task EXP values with category buttons.
 * @returns {EmbedBuilder} The initial embed for raid points.
 */
export function getPointsOverviewEmbed() {
    return new EmbedBuilder()
        .setColor(0x0099FF) // Blue color for a noticeable informational embed.
        .setTitle('Raid Task EXP Values Overview')
        .setDescription('Click a button below to see the EXP values for specific task categories:')
        .setTimestamp() // Adds a timestamp to the embed.
        .setFooter({ text: 'Points are awarded upon raid completion.' });
}

/**
 * Creates and returns an Embed for Dailies EXP values.
 * @returns {EmbedBuilder} The embed containing Dailies EXP values.
 */
export function getDailiesPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x00BFFF) // Deep Sky Blue.
        .setTitle('Daily Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(DAILIES_LIST)) // Uses the helper function to format points.
        .setFooter({ text: 'Points for daily tasks.' });
}

/**
 * Creates and returns an Embed for Weeklies EXP values.
 * @returns {EmbedBuilder} The embed containing Weeklies EXP values.
 */
export function getWeekliesPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x8A2BE2) // Blue Violet.
        .setTitle('Weekly Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(WEEKLIES_LIST))
        .setFooter({ text: 'Points for weekly tasks.' });
}

/**
 * Creates and returns an Embed for TempleShrine EXP values.
 * @returns {EmbedBuilder} The embed containing TempleShrine EXP values.
 */
export function getTempleshrinePointsEmbed() {
    return new EmbedBuilder()
        .setColor(0xFFD700) // Gold.
        .setTitle('TempleShrine Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(TEMPLESHRINE_LIST))
        .setFooter({ text: 'Points for TempleShrine tasks.' });
}

/**
 * Creates and returns an Embed for Originul Daily Raid Tasks EXP values.
 * @returns {EmbedBuilder} The embed containing Originul Dailies EXP values.
 */
export function getOriginulPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x20B2AA) // Light Sea Green.
        .setTitle('Originul Daily Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(ORIGINUL_LIST))
        .setFooter({ text: 'Points for Originul daily tasks.' });
}

/**
 * Creates and returns an Embed for Other Raid Tasks EXP values.
 * @returns {EmbedBuilder} The embed containing Other Tasks EXP values.
 */
export function getOthersPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0xDC143C) // Crimson.
        .setTitle('Other Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(OTHERS_LIST))
        .setFooter({ text: 'Points for miscellaneous tasks.' });
}

export function getGenericPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0xFF8C00) // Dark Orange.
        .setTitle('Generic Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(GENERIC_TASKS_LIST))
        .setFooter({ text: 'Points for generic tasks.' });
}

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
        // Check if the message is in an active raid thread and sent by the raid requester.
        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && message.author.id === raidInfo.requesterId) {
            const content = message.content.toLowerCase().trim(); // Get message content, lowercase and trim.
            let newStatus, newColor;

            // Determine the new status and color based on specific keywords.
            if (content === 'waiting') {
                newStatus = '🔵 Waiting';
                newColor = 0x0099ff; // Blue for waiting.
            } else if (content === 'full') {
                newStatus = '🔴 Full';
                newColor = 0xFF4500; // Red for full.
            } else if (content === 'ongoing') {
                newStatus = '🟢 Ongoing';
                newColor = 0x32CD32; // Lime Green for ongoing.
            }

            // If a new status was determined, update the raid embed and react to the message.
            if (newStatus) {
                await updateRaidStatus(client, message.channel.id, newStatus, newColor);
                await message.react('👍'); // React with a thumbs-up to acknowledge.
                return; // Stop further processing as this message was a status update.
            }
        }

        // --- Logic for boss mechanic charts within any thread ---
        // Check if the message is in a thread (any thread, not just raid threads).
        if (message.channel.isThread()) {
            const threadCommand = message.content.toLowerCase().trim();
            let embedToSend;

            // Check for specific chart commands and create the corresponding embed.
            if (threadCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Raid Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg') // Image URL for the chart.
                    .setFooter({ text: 'Speaker chart for 1-man raids' });
            } else if (threadCommand === '!2man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('2-Man Raid Chart')
                    .setImage('https://files.catbox.moe/49a6oj.jpg')
                    .setFooter({ text: 'Speaker chart for 2-man raids' });
            } else if (threadCommand === '!3man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('3-Man Raid Chart')
                    .setImage('https://files.catbox.moe/5x4grv.jpg')
                    .setFooter({ text: 'Speaker chart for 3-man raids' });
            } else if (threadCommand === '!4man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('4-Man Raid Chart')
                    .setImage('https://files.catbox.moe/yi71zh.jpg')
                    .setFooter({ text: 'Speaker chart for 4-man raids' });
            }

            // If a chart embed was created, send it to the thread.
            if (embedToSend) {
                try {
                    await message.channel.send({ embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending ${threadCommand} chart:`, error);
                    await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                }
            }
        }

        // --- NEW: Handle !raidmaps without a number ---
        if (message.content.toLowerCase().trim() === '!raidmaps') {
            await message.channel.send('The proper format is `!raidmaps [number]`. Please provide the map number.');
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
        // --- Handle the !raidmaps command ---
        if (message.content.toLowerCase() === '!raidsite') {
            const raidMapsEmbed = new EmbedBuilder()
                .setColor(0x0099FF) // A suitable color
                .setTitle('🗺️ Raid Maps for AQW')
                .setDescription('Clicking the link will lead you to a tool that makes joining maps easier:')
                .setURL('https://neiru.vercel.app/aqw/raid/maps') // The link you provided
                .setTimestamp()
                .setFooter({ text: 'Raid Helper Bot | Raid Maps' });

            try {
                await message.channel.send({ embeds: [raidMapsEmbed] });
            } catch (error) {
                console.error('Error sending !!raidsite embed:', error);
                await message.channel.send('Failed to display raid site. Please try again later.');
            }
        } 

        // --- Command to list all available raid tasks with their categories (`!raidtasks`) ---
        if (message.content.toLowerCase() === '!raidtasks') {
            try {
                // Send the embed generated by `getTasksEmbed()`.
                await message.channel.send({ embeds: [getTasksEmbed()] });
            } catch (error) {
                console.error('Error sending !raidtasks message:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
        }

        // --- MODIFIED: Command to display the EXP points for each raid task with category buttons (`!raidpoints`) ---
        if (message.content.toLowerCase() === '!raidpoints') {
            try {
                // Send the overview embed along with the two rows of category buttons.
                await message.channel.send({
                    embeds: [getPointsOverviewEmbed()],
                    components: [raidPointsButtonsRow1, raidPointsButtonsRow2]
                });
            } catch (error) {
                console.error('Error sending !raidpoints message:', error);
                await message.channel.send('Failed to display raid points. Please try again later.');
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

        // This handler is now ONLY responsible for:
        // 1. Handling the initial 'raidRequestModal' submission.
        // 2. Handling the `!raidpoints` category buttons.
        // All thread-specific buttons/modals ('closeRaidTicket', 'editTask_btn', 'editTaskModal')
        // are handled in `expLairHandler.js` to avoid duplicate processing and ensure single responsibility.

        if (interaction.isButton()) {
            switch (interaction.customId) {
                // --- Handle `!raidpoints` category buttons ---
                case 'dailiesPoints_btn':
                    // Reply with an ephemeral embed showing daily points (only visible to the user who clicked).
                    await interaction.reply({ embeds: [getDailiesPointsEmbed()], ephemeral: true });
                    break;
                case 'weekliesPoints_btn':
                    await interaction.reply({ embeds: [getWeekliesPointsEmbed()], ephemeral: true });
                    break;
                case 'templeshrinePoints_btn':
                    await interaction.reply({ embeds: [getTempleshrinePointsEmbed()], ephemeral: true });
                    break;
                case 'originulPoints_btn':
                    await interaction.reply({ embeds: [getOriginulPointsEmbed()], ephemeral: true });
                    break;
                case 'othersPoints_btn':
                    await interaction.reply({ embeds: [getOthersPointsEmbed()], ephemeral: true });
                    break;
                case 'genericTasksPoints_btn':
                    await interaction.reply({ embeds: [getGenericPointsEmbed()], ephemeral: true });
                    break;

                // The 'startRaid_btn' is handled in `generalCommandsHandler.js`.
                // The 'closeRaidTicket' and 'editTask_btn' are handled in `expLairHandler.js`.

                default:
                    // Only log if it's not a button intended for other handlers (which should ideally be caught there).
                    if (!['closeRaidTicket', 'editTask_btn', 'startRaid_btn'].includes(interaction.customId)) {
                        console.log(`Unhandled button interaction customId in raidLogsHandler: ${interaction.customId}`);
                    }
                    break;
            }
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

                // Defer the reply to give the bot more time to process without timing out.
                await interaction.deferReply({ ephemeral: true });

                // Split tasks by '+' to handle multiple tasks (e.g., 'task1 + task2').
                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                // Validate each individual task against allowed task names.
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) { // Removed custom task prefix check
                        // If an invalid task is found, send an error reply with the tasks embed.
                        await interaction.editReply({
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                            embeds: [getTasksEmbed()],
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
                            .setTitle(`New Raid Request: ${task}`)
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }) // Set author as the requesting user.
                            .addFields(
                                { name: 'Requested By', value: `<@${interaction.user.id}>` },
                                { name: 'Task(s)', value: task, inline: true },
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

                        // Start a new thread off the sent message for discussion.
                        const thread = await sentMessage.startThread({
                            name: `${task} | ${mapName} | ${server} | ${interaction.user.username}`, // Thread name.
                            autoArchiveDuration: 60, // Thread auto-archives after 60 minutes of inactivity.
                            reason: `Raid request from ${interaction.user.tag}`,
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
                        await interaction.editReply({ content: 'Your raid request has been submitted and a thread has been created!', ephemeral: true });
                    } else {
                        // If the raid logs channel is not a text channel, send an error.
                        await interaction.editReply({ content: 'Error: Could not find the raid logs channel or it is not a text channel.', ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error handling modal submission and creating raid:', error);
                    // Provide a user-friendly error message if something goes wrong.
                    await interaction.editReply({ content: 'There was an error processing your request and creating the raid. Please try again later.', ephemeral: true });
                }
            }
            // All other modals (like 'editTaskModal') are handled in `expLairHandler.js`.
        }
    });
}
