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
    DAILIES_LIST, // Import from constants
    WEEKLIES_LIST, // Import from constants
    ALLOWED_TASK_NAMES, // Import from constants
    DISPLAY_POINTS_LIST // Import from constants
} from '../config/constants.js'; // Centralized constants

// This state will be managed by the expLairHandler, but raidLogsHandler needs to add to it.
// It's better to manage this in a shared state module, but for this specific split,
// we'll explicitly import and update it.
import { activeRaidThreads } from './expLairHandler.js';

// --- Button Definitions ---
const helpButton = new ButtonBuilder()
    .setCustomId("showHelpModal")
    .setLabel('Help')
    .setStyle(ButtonStyle.Primary);

const helpButtonRow = new ActionRowBuilder()
    .addComponents(helpButton);

const closeTicketButton = new ButtonBuilder() // Define here as it's used in this handler
    .setCustomId("closeRaidTicket")
    .setLabel('Close Raid')
    .setStyle(ButtonStyle.Danger);

const closeTicketButtonRow = new ActionRowBuilder()
    .addComponents(closeTicketButton);

export function setupRaidLogsHandlers(client) {
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

        // --- Corrected !Help command implementation ---
        if (message.channel.id === RAID_CHANNEL_ID && message.content.toLowerCase() === '!help') {
            try {
                const dailiesListFormatted = DAILIES_LIST.map(task => `\`${task}\``).join(', ');
                const weekliesListFormatted = WEEKLIES_LIST.map(task => `\`${task}\``).join(', ');

                await message.channel.send({
                    content: `**!leaderboard** to show the current ranking in the server.\n\n` +
                                 `**Possible tasks:**\n` +
                                 `**Weekly or Ultra Weeklies:** ${weekliesListFormatted}\n` +
                                 `**Daily or Ultra Dailies:** ${dailiesListFormatted}\n\n` +
                                 `Type \`!raidpoints\` to show the list of points.`
                });
            } catch (error) {
                console.error('Error sending help message with task list:', error);
            }
        }

        // --- !raidpoints --- //
        if (message.channel.id === RAID_CHANNEL_ID && message.content.toLowerCase() === '!raidpoints') {
            try {
                const formattedPoints = DISPLAY_POINTS_LIST.map(point => `• ${point}`).join('\n');

                await message.channel.send({
                    content: `**${formattedPoints}**`
                });
            } catch (error) {
                console.error('Error sending message: ', error);
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
                    .setLabel("Task (see !help for all options)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder(`Enter task(s) like 'daily' or 'nulgath+drakath'`);

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
                // Modified: Use a regex to split by '+' with optional spaces around it
                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) {
                        await interaction.editReply({ content: `Invalid task "${singleTask}". Please use one of: ${ALLOWED_TASK_NAMES.map(t => `\`${t}\``).join(', ')}. If requesting multiple, separate with '+'.`, ephemeral: true });
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

                        // Store raid info in activeRaidThreads, managed by expLairHandler
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