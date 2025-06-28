import {
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    TextChannel,
    EmbedBuilder
} from 'discord.js';
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
    POINTS_CONFIG
} from '../config/constants.js';
import { activeRaidThreads, updateRaidStatus } from './sharedState.js';

// --- Button Definitions for initial raid request and closing a thread ---
// These buttons are defined internally here as they are primarily used within this handler's logic.
const helpButton = new ButtonBuilder()
    .setCustomId("showHelpModal")
    .setLabel('🏹 Help')
    .setStyle(ButtonStyle.Primary);

const helpButtonRow = new ActionRowBuilder()
    .addComponents(helpButton);

const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

// --- NEW: Edit Task Button ---
const editTaskButton = new ButtonBuilder() // Renamed from addTaskButton
    .setCustomId("editTask_btn") // Changed customId
    .setLabel('✏️ Edit Task') // Changed label
    .setStyle(ButtonStyle.Secondary);


// --- Updated: Include editTaskButton in the row sent to the thread ---
const threadActionRow = new ActionRowBuilder()
    .addComponents(closeTicketButton, editTaskButton); // Now includes both buttons

/**
 * Generates a formatted string of task names and their EXP values.
 * This helper function ensures consistent display of point values.
 * @returns {string} Formatted string of all tasks and their points.
 */
export function getFormattedPointsList() { // Exported for use in index.js or other handlers
    return Object.entries(POINTS_CONFIG).map(([task, points]) => `• \`${task}\` = ${points} EXP`).join('\n');
}

/**
 * Creates and returns the Embed for available raid tasks.
 * This embed lists all categorized raid tasks.
 * @returns {EmbedBuilder} The embed containing raid tasks.
 */
export function getTasksEmbed() { // Exported for use in index.js
    const dailiesListFormatted = DAILIES_LIST.map(task => `\`${task}\``).join(', ');
    const weekliesListFormatted = WEEKLIES_LIST.map(task => `\`${task}\``).join(', ');
    const othersListFormatted = OTHERS_LIST.map(task => `\`${task}\``).join(', ');
    const templeShrineListFormatted = TEMPLESHRINE_LIST.map(task => `\`${task}\``).join(', ');
    const originulListFormatted = ORIGINUL_LIST.map(task => `\`${task}\``).join(', ');

    return new EmbedBuilder()
        .setColor(0x3498DB) // Green color for a positive information display
        .setTitle('Available Raid Tasks')
        .setDescription('Here are the tasks you can request assistance for:')
        .addFields(
            { name: '`Weekly` or `Weeklies`', value: weekliesListFormatted || 'N/A' },
            { name: '`Daily` or `Dailies`', value: dailiesListFormatted || 'N/A' },
            { name: '`TempleShrine`', value: templeShrineListFormatted || 'N/A' },
            { name: '`Originul`', value: originulListFormatted || 'N/A' },
            { name: '`Other` Tasks', value: othersListFormatted || 'N/A' }
        )
        .setFooter({ text: 'Use these names in your raid requests!' });
}

/**
 * Creates and returns the Embed for raid task EXP values.
 * This embed provides a detailed list of points awarded per task.
 * @returns {EmbedBuilder} The embed containing EXP values.
 */
export function getPointsEmbed() { // Exported for use in index.js
    const formattedPoints = getFormattedPointsList();
    return new EmbedBuilder()
        .setColor(0xFFA500) // Orange color for a noticeable informational embed
        .setTitle('Raid Task EXP Values')
        .setDescription(formattedPoints)
        .setFooter({ text: 'Points are awarded upon raid completion.' });
}

/**
 * Creates and returns the Modal for raid assistance requests.
 * This modal collects essential information for a new raid request.
 * @returns {ModalBuilder} The modal for raid requests.
 */
export function getRaidRequestModal() { // Exported for use in index.js
    const modal = new ModalBuilder()
        .setCustomId('raidRequestModal')
        .setTitle('Raid Assistance Request');

    const taskInput = new TextInputBuilder()
        .setCustomId('taskInput')
        .setLabel("Task (see !raidtasks for all options)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(`Enter task(s) like 'daily' or 'nulgath + drakath'`);

    const mapNameInput = new TextInputBuilder()
        .setCustomId('mapNameInput')
        .setLabel("Map Name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., ultraspeaker, championdrakath, etc.');

    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel("Server (e.g., Artix, Yorumi, Safiria)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria');

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
    return modal;
}

/**
 * Sets up event handlers for raid logging functionalities, including raid requests,
 * status updates, and boss mechanic charts within threads.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export function setupRaidLogsHandlers(client) {
    // --- Message Create Listener (for commands and status updates) ---
    // This listener processes text commands and updates raid statuses based on user input.
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots to prevent loops

        // --- Logic for status updates within active raid threads ---
        // Allows the raid requester to type 'waiting' or 'full' to dynamically update the status
        // on the original raid request embed in the main raid logs channel.
        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && message.author.id === raidInfo.requesterId) {
            const content = message.content.toLowerCase().trim();
            let newStatus, newColor;

            if (content === 'waiting') {
                newStatus = '🔵 Waiting';
                newColor = 0x0099ff; // Blue for waiting
            } else if (content === 'full') {
                newStatus = '🔴 Full';
                newColor = 0xFF4500; // Red for full
            } else if (content === 'ongoing') {
                newStatus = '🟢 Ongoing';
                newColor = 0x32CD32; // Lime Green for ongoing
            }

            if (newStatus) {
                await updateRaidStatus(client, message.channel.id, newStatus, newColor);
                await message.react('👍'); // React to confirm the status change
                return; // Stop further processing as it's a status command
            }
        }

        // --- Logic for boss mechanic charts within any thread ---
        // Responds with specific image embeds for 1-man, 2-man, 3-man, and 4-man raid charts
        // when relevant commands (!1man, !2man, etc.) are used inside a thread.
        if (message.channel.isThread()) {
            const threadCommand = message.content.toLowerCase().trim();
            let embedToSend;

            if (threadCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Raid Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg') // Placeholder for 1-man chart
                    .setFooter({ text: 'Speaker chart for 1-man raids' });
            } else if (threadCommand === '!2man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('2-Man Raid Chart')
                    .setImage('https://files.catbox.moe/49a6oj.jpg') // Placeholder for 2-man chart
                    .setFooter({ text: 'Speaker chart for 2-man raids' });
            } else if (threadCommand === '!3man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('3-Man Raid Chart')
                    .setImage('https://files.catbox.moe/5x4grv.jpg') // Placeholder for 3-man chart
                    .setFooter({ text: 'Speaker chart for 3-man raids' });
            } else if (threadCommand === '!4man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('4-Man Raid Chart')
                    .setImage('https://files.catbox.moe/yi71zh.jpg') // Placeholder for 4-man chart
                    .setFooter({ text: 'Speaker chart for 4-man raids' });
            }

            if (embedToSend) {
                try {
                    await message.channel.send({ embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending ${threadCommand} chart:`, error);
                    await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                }
            }
        }

        // --- Command to list all available raid tasks with their categories ---
        // This command helps users understand the valid task names they can use when requesting raids.
        if (message.content.toLowerCase() === '!raidtasks') {
            try {
                await message.channel.send({ embeds: [getTasksEmbed()] });
            } catch (error) {
                console.error('Error sending !raidtasks message:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
        }

        // --- Command to display the EXP points for each raid task ---
        // This command provides a clear list of how much experience points each raid task awards.
        if (message.content.toLowerCase() === '!raidpoints') {
            try {
                await message.channel.send({ embeds: [getPointsEmbed()] });
            } catch (error) {
                console.error('Error sending !raidpoints message:', error);
                await message.channel.send('Failed to display raid points. Please try again later.');
            }
        }
    });

    // --- Interaction Create Listener (for button clicks and modal submissions) ---
    client.on('interactionCreate', async interaction => {
        // --- Handles the "Show Help Modal" button click ---
        // When a user clicks the '🏹 Help' button, a modal form pops up for them to input
        // the detailed information about their raid assistance request.
        if (interaction.isButton()) {
            if (interaction.customId === 'showHelpModal') {
                const modal = getRaidRequestModal(); // Use the exported function
                await interaction.showModal(modal);
            }
        }

        // --- Handles the submission of the raid request modal ---
        // Once the modal is submitted, this block validates the entered tasks,
        // creates a new embedded message in the raid logs channel, tags helpers,
        // and initiates a dedicated thread for the raid discussion.
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') {
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                await interaction.deferReply({ ephemeral: true }); // Acknowledge the interaction to prevent timeout

                // --- Validate requested tasks against the ALLOWED_TASK_NAMES list ---
                // Ensures that only recognized tasks are submitted, providing feedback for invalid entries.
                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) {
                        await interaction.editReply({
                            // MODIFIED: Send getTasksEmbed as embed instead of raw string
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                            embeds: [getTasksEmbed()], // Use the embed here
                            ephemeral: true
                        });
                        return; // Stop processing if any task is invalid
                    }
                }

                try {
                    const raidLogsChannel = await client.channels.fetch(RAID_LOGS_CHANNEL_ID);

                    if (raidLogsChannel instanceof TextChannel) {
                        // --- Create the initial embed message for the raid log ---
                        // This embed summarizes the raid request and is posted in the main raid logs channel.
                        const embedMessage = new EmbedBuilder()
                            .setColor(0x0099ff) // Blue color to signify an active, waiting request
                            .setTitle(`New Raid Request: ${task}`)
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                            .addFields(
                                { name: 'Requested By', value: `<@${interaction.user.id}>` },
                                { name: 'Task(s)', value: task, inline: true },
                                { name: 'Map Name', value: mapName, inline: true },
                                { name: 'Server', value: server, inline: true },
                                { name: 'Status', value: '🔵 Waiting', inline: true }, // Initial status: Blue circle for waiting
                                { name: 'Description', value: description || 'No description provided.' },
                            )
                            .setTimestamp()
                            .setFooter({ text: 'Raid Request System' });

                        // --- Send the raid request message and ping the raid helper role ---
                        // The message is sent to the designated raid logs channel, alerting relevant roles.
                        const sentMessage = await raidLogsChannel.send({
                            embeds: [embedMessage],
                            content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}!`,
                        });

                        // --- Start a new thread for discussion and coordination of this raid ---
                        // A dedicated thread is created for each raid request to keep conversations organized.
                        const thread = await sentMessage.startThread({
                            name: `${task} | ${mapName} | ${server} | ${interaction.user.username}`,
                            autoArchiveDuration: 60, // Thread archives after 60 minutes of inactivity to keep channels clean
                            reason: `Raid request from ${interaction.user.tag}`,
                        });

                        // --- Send instructions and buttons to the new thread ---
                        // Now includes both "Edit Task" and "Close Raid" buttons.
                        await thread.send({
                            content: `Discuss details here!\n\nTo update the status, the raid requester can type **waiting** or **full** in this thread.\n\nClick the button below once the raid is complete or to edit tasks:`, // Updated instruction
                            components: [threadActionRow] // Use the new threadActionRow
                        });

                        // --- Store essential raid information in memory for status updates and completion handling ---
                        // This in-memory state (activeRaidThreads) is crucial for other handlers (like expLairHandler)
                        // to correctly process status changes and raid completions for this specific thread.
                        activeRaidThreads[thread.id] = {
                            messageId: sentMessage.id, // ID of the initial embed in the raid logs channel
                            originalChannelId: raidLogsChannel.id, // ID of the channel where the embed was posted
                            task: task, // Original raw task string (e.g., "daily + dage")
                            requesterId: interaction.user.id,
                            mapName: mapName,
                            server: server,
                            description: description,
                            awaitingCompletion: false // Flag managed by expLairHandler for completion flow
                        };
                        console.log(`Active raid thread created: ${thread.id} for task ${task} by ${interaction.user.tag}`);

                        // --- Confirm submission to the user who made the request ---
                        // A final ephemeral message confirms to the user that their request was successfully processed.
                        await interaction.editReply({ content: 'Your raid request has been submitted and a thread has been created!', ephemeral: true });
                    } else {
                        await interaction.editReply({ content: 'Error: Could not find the raid logs channel or it is not a text channel.', ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error handling modal submission and creating raid:', error);
                    await interaction.editReply({ content: 'There was an error processing your request and creating the raid. Please try again later.', ephemeral: true });
                }
            }
        }
    });
}
