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
    ALLOWED_TASK_NAMES,
    DISPLAY_POINTS_LIST
} from '../config/constants.js';
// --- MODIFIED: Import from the new shared state file ---
import { activeRaidThreads, updateRaidStatus } from './sharedState.js';

// --- Button Definitions ---
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

const closeTicketButtonRow = new ActionRowBuilder()
    .addComponents(closeTicketButton);

export function setupRaidLogsHandlers(client) {
    // --- Message Create Listener (for commands and status updates) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        // --- NEW: Status update logic inside raid threads ---
        const raidInfo = activeRaidThreads[message.channel.id];
        if (message.channel.isThread() && raidInfo && message.author.id === raidInfo.requesterId) {
            const content = message.content.toLowerCase().trim();
            let newStatus, newColor;

            if (content === 'waiting') {
                newStatus = '🔵 Waiting';
                newColor = 0x0099ff; //green
            } else if (content === 'full') {
                newStatus = '🔴 Full';
                newColor = 0xFF4500; // Red
            }

            if (newStatus) {
                await updateRaidStatus(client, message.channel.id, newStatus, newColor);
                await message.react('👍'); // React to the message to confirm the change
                return; // Stop further processing
            }
        }
        
        if (message.channel.isThread()) {
            const threadCommand = message.content.toLowerCase().trim(); // Use a single variable for consistency

            let embedToSend;

            if (threadCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Raid Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg') // Your Imgur link here
                    .setFooter({ text: 'Speaker chart for 1-man raids' });
            } else if (threadCommand === '!2man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('2-Man Raid Chart')
                    .setImage('https://files.catbox.moe/49a6oj.jpg') // Replace with your 2-man Imgur link
                    .setFooter({ text: 'Speaker chart for 2-man raids' });
            } else if (threadCommand === '!3man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('3-Man Raid Chart')
                    .setImage('https://files.catbox.moe/5x4grv.jpg') // Replace with your 3-man Imgur link
                    .setFooter({ text: 'Speaker chart for 3-man raids' });
            } else if (threadCommand === '!4man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('4-Man Raid Chart')
                    .setImage('https://files.catbox.moe/yi71zh.jpg') // Replace with your 4-man Imgur link
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


        // Command to send the initial Help button
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

        // !Help command
        if (message.content.toLowerCase() === '!raidtasks') {
            try {
                const dailiesListFormatted = DAILIES_LIST.map(task => `\`${task}\``).join(', ');
                const weekliesListFormatted = WEEKLIES_LIST.map(task => `\`${task}\``).join(', ');
                const othersListFormatted = OTHERS_LIST.map(task => `\`${task}\``).join(', ');
                const templeShrineListFormatted = TEMPLESHRINE_LIST.map(task => `\`${task}\``).join(', ');
                await message.channel.send({
                    content: `**Possible tasks:**\n` +
                             `**Weekly or Ultra Weeklies:** ${weekliesListFormatted}\n` +
                             `**Daily or Ultra Dailies:** ${dailiesListFormatted}\n` +
                             `**Temple Shrine:** ${templeShrineListFormatted}\n` +
                             `**Other Tasks:** ${othersListFormatted}\n\n`
                });

                const formattedPoints = 
                await message.channel.send({ content: `**${formattedPoints}**` });

            } catch (error) {
                console.error('Error sending help message:', error);
            }
        }

        if (message.content.toLowerCase() === '!raidpoints') {
            try {
                await message.channel.send({
                    content: DISPLAY_POINTS_LIST.map(point => `• ${point}`).join('\n')
                });

                const formattedPoints = 
                await message.channel.send({ content: `**${formattedPoints}**` });

            } catch (error) {
                console.error('Error sending help message:', error);
            }
        }        

    });

    // --- Interaction Create Listener (for button clicks and modal submissions) ---
    client.on('interactionCreate', async interaction => {
        if (interaction.isButton()) {
            if (interaction.customId === 'showHelpModal') {
                // (Modal creation logic remains the same)
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
                await interaction.showModal(modal);
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') {
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                await interaction.deferReply({ ephemeral: true });

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
                        // --- MODIFIED: Added Status field ---
                        const embedMessage = new EmbedBuilder()
                            .setColor(0x0099ff) // Blue for waiting
                            .setTitle(`New Raid Request: ${task}`)
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                            .addFields(
                                { name: 'Requested By', value: `<@${interaction.user.id}>` },
                                { name: 'Task(s)', value: task, inline: true },
                                { name: 'Map Name', value: mapName, inline: true },
                                { name: 'Server', value: server, inline: true },
                                { name: 'Status', value: '🔵 Waiting', inline: true }, // Initial status
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
                            content: `Discuss details here!\n\nTo update the status, the raid requester can type **waiting ** or **full** in this thread.\n\nClick the button below once the raid is complete:`,
                            components: [closeTicketButtonRow]
                        });

                        // --- MODIFIED: Store message ID and channel ID for status updates ---
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
                        await interaction.editReply({ content: 'Error: Could not find the raid logs channel.', ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error handling modal submission:', error);
                    await interaction.editReply({ content: 'There was an error processing your request.', ephemeral: true });
                }
            }
        }
    });
}
