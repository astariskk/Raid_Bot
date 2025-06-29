// handlers/raidLogsHandler.js
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
    POINTS_CONFIG,
    CUSTOM_TASK_PREFIX // Import CUSTOM_TASK_PREFIX
} from '../config/constants.js';
import { activeRaidThreads, updateRaidStatus } from '../activeRaidState.js';
// Removed updateRaidLogEmbed from here as it's not used directly by this handler's modal logic anymore

// --- Button Definitions for initial raid request and closing a thread ---
// These buttons are defined here because raidLogsHandler is responsible for *creating* the thread
// and sending these buttons *initially* to the thread. The *handling* of their clicks
// is done in expLairHandler (for close/edit) and generalCommandsHandler (for initial raid start).
const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

const editTaskButton = new ButtonBuilder()
    .setCustomId("editTask_btn")
    .setLabel('✏️ Edit Task')
    .setStyle(ButtonStyle.Secondary);

const threadActionRow = new ActionRowBuilder()
    .addComponents(closeTicketButton, editTaskButton);

// --- Buttons for !raidpoints embed ---
const dailiesPointsButton = new ButtonBuilder()
    .setCustomId('dailiesPoints_btn')
    .setLabel('Dailies Points')
    .setStyle(ButtonStyle.Primary);

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

// ActionRow for the !raidpoints command buttons
const raidPointsButtonsRow1 = new ActionRowBuilder()
    .addComponents(dailiesPointsButton, weekliesPointsButton, templeshrinePointsButton);

const raidPointsButtonsRow2 = new ActionRowBuilder()
    .addComponents(originulPointsButton, othersPointsButton);


/**
 * Generates a formatted string of task names and their EXP values for a given list.
 * @param {string[]} taskList - The list of tasks (e.g., DAILIES_LIST).
 * @returns {string} Formatted string of tasks and their points.
 */
function formatTaskListPoints(taskList) {
    if (!taskList || taskList.length === 0) return 'N/A';
    return taskList.map(task => `• \`${task}\` = ${POINTS_CONFIG[task] || 0} EXP`).join('\n');
}

/**
 * Creates and returns the Embed for available raid tasks.
 * This embed lists all categorized raid tasks.
 * @returns {EmbedBuilder} The embed containing raid tasks.
 */
export function getTasksEmbed() {
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
            { name: '`Originul` Dailies:', value: originulListFormatted || 'N/A' },
            { name: 'Other Tasks', value: othersListFormatted || 'N/A' },
            { name: 'Custom Tasks', value: `You can also request custom tasks using the format \`${CUSTOM_TASK_PREFIX}yourtaskname\`.\n*Points for custom tasks are assigned manually by moderators.*` }
        )
        .setFooter({ text: 'Use these names in your raid requests!' });
}

/**
 * Creates and returns the initial Embed for raid task EXP values with category buttons.
 * @returns {EmbedBuilder} The initial embed for raid points.
 */
export function getPointsOverviewEmbed() {
    return new EmbedBuilder()
        .setColor(0x0099FF) // Orange color for a noticeable informational embed
        .setTitle('Raid Task EXP Values Overview')
        .setDescription('Click a button below to see the EXP values for specific task categories:')
        .setTimestamp()
        .setFooter({ text: 'Points are awarded upon raid completion.' });
}

/**
 * Creates and returns an Embed for Dailies EXP values.
 * @returns {EmbedBuilder} The embed containing Dailies EXP values.
 */
export function getDailiesPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x00BFFF) // Deep Sky Blue
        .setTitle('Daily Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(DAILIES_LIST))
        .setFooter({ text: 'Points for daily tasks.' });
}

/**
 * Creates and returns an Embed for Weeklies EXP values.
 * @returns {EmbedBuilder} The embed containing Weeklies EXP values.
 */
export function getWeekliesPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x8A2BE2) // Blue Violet
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
        .setColor(0xFFD700) // Gold
        .setTitle('TempleShrine Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(TEMPLESHRINE_LIST))
        .setFooter({ text: 'Points for TempleShrine tasks.' });
}

/**
 * Creates and returns an Embed for Originul Dailies EXP values.
 * @returns {EmbedBuilder} The embed containing Originul Dailies EXP values.
 */
export function getOriginulPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0x20B2AA) // Light Sea Green
        .setTitle('Originul Daily Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(ORIGINUL_LIST))
        .setFooter({ text: 'Points for Originul daily tasks.' });
}

/**
 * Creates and returns an Embed for Other Tasks EXP values.
 * @returns {EmbedBuilder} The embed containing Other Tasks EXP values.
 */
export function getOthersPointsEmbed() {
    return new EmbedBuilder()
        .setColor(0xDC143C) // Crimson
        .setTitle('Other Raid Tasks EXP Values')
        .setDescription(formatTaskListPoints(OTHERS_LIST))
        .setFooter({ text: 'Points for miscellaneous tasks.' });
}


/**
 * Creates and returns the Modal for raid assistance requests.
 * This modal collects essential information for a new raid request.
 * @returns {ModalBuilder} The modal for raid requests.
 */
export function getRaidRequestModal() {
    const modal = new ModalBuilder()
        .setCustomId('raidRequestModal')
        .setTitle('Raid Assistance Request');

    const taskInput = new TextInputBuilder()
        .setCustomId('taskInput')
        .setLabel("Task(s) (!raidtasks for options): ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(`Enter task(s) like 'daily' or 'nulgath + drakath'`);

    const mapNameInput = new TextInputBuilder()
        .setCustomId('mapNameInput')
        .setLabel("Map Name: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., ultraspeaker, championdrakath, etc.');

    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel("Server: ")
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
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        // --- Logic for status updates within active raid threads ---
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
                await message.react('👍');
                return;
            }
        }

        // --- Logic for boss mechanic charts within any thread ---
        if (message.channel.isThread()) {
            const threadCommand = message.content.toLowerCase().trim();
            let embedToSend;

            if (threadCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Raid Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg')
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
        if (message.content.toLowerCase() === '!raidtasks') {
            try {
                // Now getTasksEmbed includes custom task info
                await message.channel.send({ embeds: [getTasksEmbed()] }); 
            } catch (error) {
                console.error('Error sending !raidtasks message:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
        }

        // --- MODIFIED: Command to display the EXP points for each raid task with buttons ---
        if (message.content.toLowerCase() === '!raidpoints') {
            try {
                // Send the overview embed with buttons
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
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        // This handler is now ONLY responsible for:
        // 1. Handling the initial 'raidRequestModal' submission.
        // 2. Handling the !raidpoints category buttons.
        // All thread-specific buttons/modals ('closeRaidTicket', 'editTask_btn', 'editTaskModal')
        // are handled in expLairHandler.js to avoid duplicate processing.

        if (interaction.isButton()) {
            switch (interaction.customId) {
                // --- Handle !raidpoints category buttons ---
                case 'dailiesPoints_btn':
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

                // The 'startRaid_btn' is handled in generalCommandsHandler.js
                // The 'closeRaidTicket' and 'editTask_btn' are handled in expLairHandler.js

                default:
                    // Only log if it's not a button intended for other handlers (which should ideally be caught there)
                    if (!['closeRaidTicket', 'editTask_btn', 'startRaid_btn'].includes(interaction.customId)) {
                        console.log(`Unhandled button interaction customId in raidLogsHandler: ${interaction.customId}`);
                    }
                    break;
            }
        }

        // --- Handle Modal Submissions ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') { // Only this modal should be handled here
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                await interaction.deferReply({ ephemeral: true });

                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                for (const singleTask of requestedTasks) {
                    // MODIFIED: Validate against ALLOWED_TASK_NAMES OR CUSTOM_TASK_PREFIX
                    if (!ALLOWED_TASK_NAMES.includes(singleTask) && !singleTask.startsWith(CUSTOM_TASK_PREFIX)) {
                        await interaction.editReply({
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                            embeds: [getTasksEmbed()],
                            ephemeral: true
                        });
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
                                { name: 'Status', value: '🔵 Waiting', inline: true },
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
                            content: `Discuss details here!\n\nTo update the status, the raid requester can type **waiting**, **ongoing** or **full** in this thread.\n\nClick the button below once the raid is complete or to edit tasks:`,
                            components: [threadActionRow]
                        });

                        activeRaidThreads[thread.id] = {
                            messageId: sentMessage.id,
                            originalChannelId: raidLogsChannel.id,
                            task: task,
                            requesterId: interaction.user.id,
                            mapName: mapName,
                            server: server,
                            description: description,
                            awaitingCompletion: false
                        };
                        console.log(`Active raid thread created: ${thread.id} for task ${task} by ${interaction.user.tag}`);

                        await interaction.editReply({ content: 'Your raid request has been submitted and a thread has been created!', ephemeral: true });
                    } else {
                        await interaction.editReply({ content: 'Error: Could not find the raid logs channel or it is not a text channel.', ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error handling modal submission and creating raid:', error);
                    await interaction.editReply({ content: 'There was an error processing your request and creating the raid. Please try again later.', ephemeral: true });
                }
            }
            // All other modals (like 'editTaskModal') are handled in expLairHandler.js
        }
    });
}
