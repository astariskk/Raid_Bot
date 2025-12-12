// handlers/raidTicketHandler.js
import {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} from 'discord.js';

import { 
    RAID_HELPER_ROLE_ID,
    RAID_CATEGORY_ID,
} from '../config/constants.js';

import {
    updateRaidStatus, 
    getRaidInfo,
    createRaid,
} from '../activeRaidState.js';
import { getCombinedTasksAndPointsEmbed } from '../Embeds/generalCommandsEmbeds.js';
import { RAID_CHARTS, twoManEmbeds, threeManEmbeds, scamChartEmbeds } from '../Embeds/raidChartsEmbeds.js';
import { threadActionRow } from '../Embeds/raidTicketEmbeds.js';
import { generateRaidMapsEmbed, parseRaidTasks } from '../utils/raidMaps.js';
import { validateAndResolveTasks } from '../utils/allowedTasks.js';



// --- Constants for Embed Colors ---
const COLOR_WAITING = 0x0099ff; // Blue for waiting
const COLOR_FULL = 0xdd2e44;    // Red for full
const COLOR_ONGOING = 0x78b159; // Lime Green for ongoing

const activeChartSessions = new Map();
const RAID_CHART_SESSION_LIFETIME_MS = 2 * 60 * 1000; // 2 minutes

function createChartActionRow(type, requesterId, sessionTimestamp, disabled = false) {
    const prev = new ButtonBuilder()
        .setCustomId(`raidchart_${type}_prev_${requesterId}_${sessionTimestamp}`)
        .setLabel('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled);

    const next = new ButtonBuilder()
        .setCustomId(`raidchart_${type}_next_${requesterId}_${sessionTimestamp}`)
        .setLabel('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled);

    return new ActionRowBuilder().addComponents(prev, next);
}

function getChartEmbed(command) {
    const chartData = RAID_CHARTS[command];
    if (!chartData) {
        return null;
    }

    const embed = new EmbedBuilder()
        .setColor(chartData.color)
        .setTitle(chartData.title)
        .setImage(chartData.image)
        .setFooter({ text: null});

    return embed;
}

async function sendInitialPaginatedEmbed(channel, embedsArray, type, requesterId) {
    const totalPages = embedsArray.length;
    const initialPage = 1;
    const sessionTimestamp = Date.now();

    const sessionData = {
        type, // '2man' or '3man'
        currentPage: initialPage,
        totalPages,
        embedsArray,
        originalRequesterId: requesterId,
        timestamp: sessionTimestamp,
        timeoutId: null
    };

    const components = totalPages > 1 ? [createChartActionRow(type, requesterId, sessionTimestamp, false)] : [];
    const sentMessage = await channel.send({
        embeds: [embedsArray[initialPage - 1]],
        components
    });

    // store session keyed by the message id
    activeChartSessions.set(sentMessage.id, sessionData);

    // set disable timeout
    const timeoutId = setTimeout(async () => {
        activeChartSessions.delete(sentMessage.id);
        try {
            const expiredMessage = await channel.messages.fetch(sentMessage.id).catch(() => null);
            if (expiredMessage) {
                if (sessionData.totalPages > 1) {
                    const disabledRow = createChartActionRow(type, requesterId, sessionTimestamp, true);
                    await expiredMessage.edit({ components: [disabledRow] });
                }
            }
        } catch (err) {
            console.error(`Error disabling raid chart buttons for message ${sentMessage.id}:`, err);
        }
    }, RAID_CHART_SESSION_LIFETIME_MS);

    sessionData.timeoutId = timeoutId;
    // update stored session with timeout id
    activeChartSessions.set(sentMessage.id, sessionData);
}

async function updateChartSessionPage(interaction, sessionKey, action, sessionTimestamp) {
    const sessionData = activeChartSessions.get(sessionKey);
    if (!sessionData) {
        // If there's no session data, disable the buttons on the message and inform user (handled by caller)
        const disabledRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('expired_prev').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('expired_next').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(true)
            );
        await interaction.update({ components: [disabledRow] }).catch(() => null);
        return;
    }

    // Ensure only original requester can interact
    if (interaction.user.id !== sessionData.originalRequesterId) {
        return interaction.reply({ content: 'You can only navigate your own chart session!', ephemeral: true });
    }

    // Clear old timeout
    if (sessionData.timeoutId) {
        clearTimeout(sessionData.timeoutId);
    }

    // change page
    if (action === 'next') {
        sessionData.currentPage = Math.min(sessionData.currentPage + 1, sessionData.totalPages);
    } else if (action === 'prev') {
        sessionData.currentPage = Math.max(sessionData.currentPage - 1, 1);
    }

    // Build fresh components (still enabled)
    const row = createChartActionRow(sessionData.type, sessionData.originalRequesterId, sessionTimestamp, false);

    // Update the message
    const newEmbed = sessionData.embedsArray[sessionData.currentPage - 1];
    try {
        await interaction.editReply({
            embeds: [newEmbed],
            components: sessionData.totalPages > 1 ? [row] : []
        });
    } catch (err) {
        // fallback to editing the message directly if editReply fails
        try {
            await interaction.message.edit({
                embeds: [newEmbed],
                components: sessionData.totalPages > 1 ? [row] : []
            });
        } catch (err2) {
            console.error('Failed to update paginated chart message:', err2);
        }
    }

    // set a new timeout to disable buttons after inactivity
    const newTimeout = setTimeout(async () => {
        activeChartSessions.delete(sessionKey);
        try {
            const expiredMessage = await interaction.channel.messages.fetch(sessionKey).catch(() => null);
            if (expiredMessage) {
                if (sessionData.totalPages > 1) {
                    const disabledRow = createChartActionRow(sessionData.type, sessionData.originalRequesterId, sessionTimestamp, true);
                    await expiredMessage.edit({ components: [disabledRow] });
                }
            }
        } catch (err) {
            console.error(`Error disabling raid chart buttons for expired session ${sessionKey}:`, err);
        }
    }, RAID_CHART_SESSION_LIFETIME_MS);

    sessionData.timeoutId = newTimeout;
    activeChartSessions.set(sessionKey, sessionData);
}

export function setupRaidTicketHandler(client) {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = await getRaidInfo(message.channel.id);
        const isRaidTicketChannel = raidInfo && message.channel.type === ChannelType.GuildText && message.channel.parentId === RAID_CATEGORY_ID;
        const content = message.content.toLowerCase().trim();

        if (isRaidTicketChannel) {

            const restrictedStatuses = ['awaiting_user_input', 'completed', 'cancelled', 'awaiting_completion', 'Completed'];
            if (restrictedStatuses.includes(raidInfo.status)) {
                return;
            }

            let newStatusTag = '';
            let newColor = 0x0099ff;

            if (content === '!waiting') {
                newStatusTag = 'Waiting';
                newColor = COLOR_WAITING;
            } else if (content === '!full') {
                newStatusTag = 'Full';
                newColor = COLOR_FULL;
            } else if (content === '!ongoing') {
                newStatusTag = 'Ongoing';
                newColor = COLOR_ONGOING;
            }

            if (newStatusTag) {

                try {
                    // Update the channel name via updateRaidStatus (which includes DB update)
                    await updateRaidStatus(client, message.channel.id, newStatusTag, newColor);
                    await message.react('👍');
                    return; 
                } catch (error) {
                    console.error(`Error updating status for channel ${message.channel.id}:`, error);
                    await message.channel.send('Failed to update raid status. Ensure the new name is valid and try again later.');
                    return; 
                }
            }
        } 

        try {
            if (content === '!2man') {
                if (isRaidTicketChannel) {
                    const messageContent = "It's movie time <@114514543899705351>";
                    const regularMessage = await message.channel.send({
                        content: messageContent
                    });       
                }    
                await sendInitialPaginatedEmbed(message.channel, twoManEmbeds, '2man', message.author.id);
                return;
            }
            if (content === '!3man') {
                await sendInitialPaginatedEmbed(message.channel, threeManEmbeds, '3man', message.author.id);
                return;
            }
            if (content === "!scamcharts" || content === "!scams") {
                await sendInitialPaginatedEmbed(message.channel, scamChartEmbeds, 'scam', message.author.id);
                return;
            }
        } catch (err) {
            console.error('Error sending paginated chart embed:', err);
        }

        const chartEmbed = getChartEmbed(content);
        if (chartEmbed) {
            let messageContent = null;
            
            // Special condition: only ping Veritus if it's the !2man command AND it's in a raid ticket channel
            if (content === '!2man' && isRaidTicketChannel) {
                messageContent = "It's movie time <@114514543899705351>";
            }

            try {
                await message.channel.send({ 
                    content: messageContent,
                    embeds: [chartEmbed] 
                });
                return;
            } catch (error) {
                console.error(`Error sending ${content} chart:`, error);
                await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                return;
            }
        }

        // --- Handle !raidmaps without a number ---
        if (content === '!raidmaps' || content === '!maps') {
            if (!isRaidTicketChannel) {
                await message.channel.send('The `!raidmaps [number]` command can only be used inside an active raid ticket channel to get join links for the tasks in that specific raid.');
            }
            return;
        }

        // --- Handle the !raidmaps <number> command ---
        const raidMapsMatch = message.content.toLowerCase().match(/^!(raidmaps|maps)\s+(\d+)$/);

        if (raidMapsMatch) {
             const mapNumber = raidMapsMatch[2];

            if (isRaidTicketChannel && raidInfo) {
                const raidTasks = parseRaidTasks(raidInfo.task);
                const embed = generateRaidMapsEmbed(raidTasks, mapNumber);

                try {
                    await message.channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error(`Error sending !raidmaps for channel ${message.channel.id}:`, error);
                    await message.channel.send('Failed to display raid maps. Please try again later.');
                }
            } else {
                await message.channel.send(
                    'The `!raidmaps [number]` command can only be used inside an active raid ticket channel.'
                );
            }
            return;
        }

        // --- Handle the !raidsite command ---
        if (content === '!raidsite') {
            const raidSiteButton = new ButtonBuilder()
                .setLabel('Go to Raid Map Tool')
                .setStyle(ButtonStyle.Link)
                .setURL('https://neiru.vercel.app/aqw/raid/maps');

            const raidSiteRow = new ActionRowBuilder().addComponents(raidSiteButton);

            try {
                await message.channel.send({
                    content: 'Site for joining maps easier',
                    components: [raidSiteRow]
                });
            } catch (error) {
                console.error('Error sending !raidsite embed:', error);
                await message.channel.send('Failed to display raid site. Please try again later.');
            }
            return;
        }

        // --- Command to list all available raid tasks with their points ---
        if (content === '!raidtasks') {
            try {
                await message.channel.send({ embeds: getCombinedTasksAndPointsEmbed() });
            } catch (error) {
                console.error('Error sending !raidtasks message:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
            return;
        }
    });

    // --- Interaction Create Listener (for button clicks and modal submissions) ---
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        const raidInfo = await getRaidInfo(interaction.channel.id);
        const isRaidTicketChannel = raidInfo && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;

        // --- Block button interactions if raid is in a special state ---
        if (isRaidTicketChannel) {
            const restrictedStatuses = ['completed', 'cancelled'];
            if (restrictedStatuses.includes(raidInfo.status)) {
                // Only reply ephemerally if the customId matches our buttons or modal
                if (interaction.isButton() && (interaction.customId === 'closeRaidTicket' || interaction.customId === 'editTask_btn')) {
                    await interaction.reply({
                        content: `This raid is currently in a '${raidInfo.status}' state. You cannot interact with these buttons at this time.`,
                        flags: MessageFlags.Ephemeral
                    });
                } else if (interaction.isModalSubmit() && interaction.customId === 'editTaskModal') {
                    await interaction.reply({
                        content: `This raid is currently in a '${raidInfo.status}' state. Tasks cannot be edited at this time.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }
        }

        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('raidRequestModal')) {

                const rawTasksInput = interaction.fields.getTextInputValue('taskInput');
                const raidType = interaction.customId.split('_')[1];

                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const mapNumber = interaction.fields.getTextInputValue('mapNumberInput'); // <-- NEW
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');
                const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);

                if (invalidTasks.length > 0) {
                    await interaction.reply({
                        content: `Task(s) not allowed in a ${raidType} room: ${invalidTasks.join(', ')}`,
                        embeds: getCombinedTasksAndPointsEmbed(),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const resolvedTaskString = resolvedTasks.join(', ');

                try {
                    const guild = interaction.guild;
                    if (!guild) {
                        await interaction.reply({ content: 'Error: This command can only be used in a server.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    // Create the new raid ticket channel
                    const baseChannelName = `${interaction.member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
                    const initialChannelName = `${baseChannelName}`; // channel will reflect waiting state

                    // Define permissions
                    const permissionOverwrites = [
                        {
                            id: guild.id, // @everyone
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: RAID_HELPER_ROLE_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                        }
                    ];

                    const raidTicketChannel = await guild.channels.create({
                        name: initialChannelName,
                        type: ChannelType.GuildText,
                        parent: RAID_CATEGORY_ID,
                        permissionOverwrites: permissionOverwrites,
                        reason: `Raid request from ${interaction.user.tag}`
                    });

                    // Create the embed for the new raid request
                    const embedMessage = new EmbedBuilder()
                        .setColor(COLOR_WAITING)
                        .setTitle(`${raidType} Raid Request by: ${interaction.member.displayName}`)
                        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                        .addFields(
                            { name: 'Task(s)', value: resolvedTaskString, inline: false },
                            { name: 'Map Name', value: mapName, inline: false },
                            { name: 'Map Number', value: mapNumber, inline: true},
                            { name: 'Server', value: server, inline: true },
                            { name: 'Status', value: 'Waiting', inline: true },
                            { name: 'Description', value: description || 'No description provided.' },
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Last updated: ' });

                    // Send embed to the new ticket channel
                    const sentMessage = await raidTicketChannel.send({
                        embeds: [embedMessage],
                        content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}`,
                    });

                    // Send instructions and buttons
                    await raidTicketChannel.send({
                        content: `To update the status, type **!waiting**, **!ongoing** or **!full** in this channel,`,
                        components: [threadActionRow]
                    });

                    await sentMessage.pin();

                    // Store in database
                    await createRaid(raidTicketChannel.id, {
                        messageId: sentMessage.id,
                        originalChannelId: raidTicketChannel.id,
                        task: resolvedTaskString,
                        requesterId: interaction.user.id,
                        mapName: mapName,
                        mapNumber: mapNumber, // <-- NEW
                        server: server,
                        description: description,
                        status: 'active',
                        color: COLOR_WAITING,
                        size: raidType,
                        proofImage: null,
                        awaitingCompletion: false,
                        originalName: baseChannelName,
                    });

                    console.log(`Raid ticket created: ${raidTicketChannel.id} for ${raidType} tasks: ${resolvedTaskString} by ${interaction.user.tag}`);

                    await interaction.reply({
                        content: `Check your new raid ticket here: <#${raidTicketChannel.id}>`,
                        flags: MessageFlags.Ephemeral
                    });

                } catch (error) {
                    console.error('Error handling modal submission and creating raid ticket channel:', error);
                }
            }
            return; 
        }
        if (interaction.isButton()) {
            const custom = interaction.customId;
            
            if (custom && custom.startsWith('raidchart_')) {
                const parts = custom.split('_');
                // validate parts
                if (parts.length < 5) {
                    return interaction.reply({ content: 'Invalid chart button identifier.', ephemeral: true });
                }

                const [, type, action, requesterId, timestampStr] = parts;
                const sessionTimestamp = parseInt(timestampStr, 10);
                const sessionKey = interaction.message.id;

                const sessionData = activeChartSessions.get(sessionKey);

                // If session not found or timed out, disable the buttons and tell user
                if (!sessionData || Date.now() - sessionData.timestamp > RAID_CHART_SESSION_LIFETIME_MS) {
                    if (sessionData && sessionData.timeoutId) clearTimeout(sessionData.timeoutId);
                    activeChartSessions.delete(sessionKey);

                    // Try to disable displayed buttons
                    try {
                        const expiredRow = createChartActionRow(type, requesterId, sessionTimestamp, true);
                        await interaction.update({ components: [expiredRow] }).catch(() => null);
                    } catch (err) {
                        // ignore
                    }
                    return interaction.followUp({ content: 'This chart session has expired. Please run the command again.', ephemeral: true });
                }

                // Only allow original requester to navigate
                if (interaction.user.id !== sessionData.originalRequesterId) {
                    return interaction.reply({ content: 'You can only navigate your own chart session!', ephemeral: true });
                }

                await updateChartSessionPage(interaction, sessionKey, action, sessionTimestamp);
                return;
            }

            switch (custom) {
                case 'raidmapsButton':
                    if (isRaidTicketChannel && raidInfo) {
                        const savedMapNumber = raidInfo.mapNumber;
                        
                        if (!savedMapNumber || !/^\d+$/.test(savedMapNumber)) {
                             await interaction.reply({
                                content: `The map number is missing or invalid in the raid information: **${savedMapNumber || 'None'}**. Please use the \`!raidmaps [number]\` command or \`!edit\` to set it.`,
                                ephemeral: true
                            });
                            return;
                        }

                        const raidTasks = parseRaidTasks(raidInfo.task);
                        const embed = generateRaidMapsEmbed(raidTasks, savedMapNumber);

                        await interaction.reply({ embeds: [embed], ephemeral: false }); 
                    } else {
                        await interaction.reply({
                            content: 'The Raid Maps button can only be used inside an active raid ticket channel.',
                            ephemeral: true
                        });
                    }
                break;

                default:
            }
        }
    });
}
