import {
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} from 'discord.js';

import { 
    RAID_HELPER_ROLE_ID,
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
    RECORD_HOLDER_ROLE_ID,
    RAID_CATEGORY_ID,
    TASK_ALIASES,
} from '../config/constants.js';

import {
    updateRaidStatus, 
    getRaidInfo,
    createRaid,
    updateRaid, 
} from '../activeRaidState.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsEmbeds.js';


// --- Constants for Embed Colors ---
const COLOR_WAITING = 0x0099ff; // Blue for waiting
const COLOR_FULL = 0xdd2e44; 	// Red for full
const COLOR_ONGOING = 0x78b159; // Lime Green for ongoing

// --- New: Map of all chart commands for easy lookup and maintenance ---
const RAID_CHARTS = {
    '!1man': {
        title: '1-Man Speaker Chart',
        image: 'https://files.catbox.moe/u3huep.png',
        color: COLOR_WAITING
    },
    '!2man': {
        title: '2-Man Speaker Chart',
        image: 'https://files.catbox.moe/hvccl7.png',
        color: COLOR_WAITING
    },
    '!2manEasy': {
        title: '2-Man Easier Version',
        image: 'https://files.catbox.moe/txgrr6.png',
        color: COLOR_WAITING
    },
    '!3man': {
        title: '3-Man Speaker Chart',
        image: 'https://files.catbox.moe/ci6veo.png',
        color: COLOR_WAITING
    },
    '!4man': {
        title: '4-Man Speaker Chart',
        image: 'https://files.catbox.moe/yi71zh.jpg',
        color: COLOR_WAITING
    },
    '!lpchart': {
        title: '2-Man LP Speakerchart',
        image: 'https://files.catbox.moe/xfb923.png',
        color: COLOR_WAITING
    },
    '!3tap':{
        title: '3-Man AP Chart',
        image: 'https://files.catbox.moe/bqzx8t.png',
        color: COLOR_WAITING
    },
    '!famischart': {
        title: 'Famis Goon',
        image: 'https://files.catbox.moe/bo3vri.png',
        color: COLOR_WAITING
    },
    '!gramielchart': {
        title: 'Gramiel Chart by Lilicht',
        image: 'https://files.catbox.moe/esowjk.png',
        color: COLOR_WAITING
    },
    '!gramiel': {
        title: 'Gramiel Chart by Lilicht',
        image: 'https://files.catbox.moe/esowjk.png',
        color: COLOR_WAITING
    },
};

/**
 * Creates an embed for a specific raid chart command.
 * @param {string} command - The command string (e.g., '!2man').
 * @returns {EmbedBuilder | null}
 */
function getChartEmbed(command) {
    const chartData = RAID_CHARTS[command];
    if (!chartData) {
        return null;
    }

    const embed = new EmbedBuilder()
        .setColor(chartData.color)
        .setTitle(chartData.title)
        .setImage(chartData.image)
        .setFooter({ text: null }); 

    return embed;
}

function isAdmin(source) {
    const member = source.member;
    if (!member) {
        console.warn('isAdmin called for a source without a member object (e.g., DM).');
        return false;
    }
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID) ||
        member.roles.cache.has(RAID_CHAMPION_ROLE_ID) ||
        member.roles.cache.has(RECORD_HOLDER_ROLE_ID)
    );
}


// Button to close a raid ticket/channel.
const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

// Button to edit the tasks associated with a raid.
const editTaskButton = new ButtonBuilder()
    .setCustomId("editTask_btn")
    .setLabel('✏️ Edit Task')
    .setStyle(ButtonStyle.Secondary);

const threadActionRow = new ActionRowBuilder() // Renamed to actionRow for channel
    .addComponents(closeTicketButton, editTaskButton);

export function getRaidRequestModal() {
    const modal = new ModalBuilder()
        .setCustomId('raidRequestModal')
        .setTitle('Raid Assistance Request');

    // Input field for the task(s).
    const taskInput = new TextInputBuilder()
        .setCustomId('taskInput')
        .setLabel("Task(s): ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(`e.g., 'daily, dage' or 'originul, astralshrine'`);

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
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
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

export function setupRaidTicketHandler(client) {
    // --- Message Create Listener (for commands and status updates within channels) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const raidInfo = await getRaidInfo(message.channel.id);
        const isRaidTicketChannel = raidInfo && message.channel.type === ChannelType.GuildText && message.channel.parentId === RAID_CATEGORY_ID;
        const content = message.content.toLowerCase().trim();

        // =========================================================================================
        // 1. RAID TICKET SPECIFIC COMMANDS (Status updates)
        // =========================================================================================
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
                    return; // Consume the message
                } catch (error) {
                    console.error(`Error updating status for channel ${message.channel.id}:`, error);
                    await message.channel.send('Failed to update raid status. Ensure the new name is valid and try again later.');
                    return; // Consume the message
                }
            }
        }
        
        // =========================================================================================
        // 2. CHART COMMANDS (Now moved outside the main ticket block)
        // =========================================================================================
        
        const chartEmbed = getChartEmbed(content);
        if (chartEmbed) {
            let messageContent = null;
            
            // Special condition: only ping Veritus if it's the !2man command AND it's in a raid ticket channel
            if (content === '!2man' && isRaidTicketChannel) {
                // The ping ID remains the same
                messageContent = "It's movie time <@114514543899705351>"; 
            }

            try {
                await message.channel.send({ 
                    content: messageContent, // Will be null for other charts or !2man outside a ticket
                    embeds: [chartEmbed] 
                });
                return; // Consume the message
            } catch (error) {
                console.error(`Error sending ${content} chart:`, error);
                await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                return; // Consume the message
            }
        }


        // =========================================================================================
        // 3. OTHER GENERAL COMMANDS (!raidmaps, !raidsite, !raidtasks)
        // =========================================================================================

        // --- Handle !raidmaps without a number ---
        if (content === '!raidmaps') {
            if (!isRaidTicketChannel) {
                await message.channel.send('The `!raidmaps [number]` command can only be used inside an active raid ticket channel to get join links for the tasks in that specific raid.');
            }
            // If it is a raid ticket, it must be blocked by the early exit restricted status check.
            return;
        }

        // --- Handle the !raidmaps <number> command ---
        const raidMapsMatch = message.content.toLowerCase().match(/^!raidmaps\s+(\d+)$/);

        if (raidMapsMatch) {
            const mapNumber = raidMapsMatch[1];

            if (isRaidTicketChannel && raidInfo) {
                // This is fine because the restricted status check above will prevent it if necessary.
                const raidTasksString = raidInfo.task;
                // Split by '+' or ','
                const rawRequestedTasks = raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim());

                let expandedTasks = [];
                for (const task of rawRequestedTasks) {
                    // Check if the task is a category alias (e.g., 'daily')
                    if (TASK_MAP_CATEGORIES[task]) {
                        expandedTasks = expandedTasks.concat(TASK_MAP_CATEGORIES[task]);
                    } else {
                        expandedTasks.push(task);
                    }
                }

                const joinLinksWithPoints = expandedTasks.map(task => {
                    // Use the task itself as the prefix if no specific mapping exists
                    const mapPrefix = TASK_TO_MAP_PREFIX_MAPPING[task] || task; 
                    return `* /join ${mapPrefix}-${mapNumber}`;
                }).join('\n');

                const embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`Raid Maps for this raid:`)
                    .setDescription(`Here are the join commands:\n\n${joinLinksWithPoints}`)
                    .setFooter(null);

                try {
                    await message.channel.send({ embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending !raidmaps for channel ${message.channel.id}:`, error);
                    await message.channel.send('Failed to display raid maps for this channel. Please try again later.');
                }
            } else {
                await message.channel.send(
                    'The `!raidmaps [number]` command can only be used inside an active raid ticket channel ' +
                    'to get join links for the tasks in that specific raid.'
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
                await message.channel.send({ embeds: [getCombinedTasksAndPointsEmbed()] });
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


        // Handle modal submissions (new raid requests are always allowed, as they create a new channel)
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') {
                const rawTaskInput = interaction.fields.getTextInputValue('taskInput');
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                // Split by '+' or ',' and resolve aliases
                const requestedTasks = rawTaskInput
                    .split(/\s*[+,]\s*/)
                    .map(t => TASK_ALIASES[t.trim().toLowerCase()] || t.trim().toLowerCase());

                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) {
                        await interaction.reply({
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+' or ','.`,
                            embeds: [getCombinedTasksAndPointsEmbed()],
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                // Create a clean, comma-separated string of the resolved tasks for the database
                const resolvedTaskString = requestedTasks.join(', ');

                try {
                    const guild = interaction.guild;
                    if (!guild) {
                        await interaction.reply({ content: 'Error: This command can only be used in a server.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    // Create the new raid ticket channel
                    // Name: requester-displayname-raid-status
                    const baseChannelName = `${interaction.member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
                    const initialChannelName = `${baseChannelName}`; // Channel name will reflect waiting state

                    // Define permissions for the new channel
                    const permissionOverwrites = [
                        {
                            id: guild.id, // @everyone role
                            deny: [PermissionFlagsBits.ViewChannel] // Deny view for everyone by default
                        },
                        {
                            id: RAID_HELPER_ROLE_ID, // Raid Helper role
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                        },
                        {
                            id: interaction.user.id, // The raid requester
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                        }
                    ];

                    const raidTicketChannel = await guild.channels.create({
                        name: initialChannelName,
                        type: ChannelType.GuildText,
                        parent: RAID_CATEGORY_ID, // Parent category ID
                        permissionOverwrites: permissionOverwrites,
                        reason: `Raid request from ${interaction.user.tag}`
                    });

                    // Create the embed message for the new raid request.
                    const embedMessage = new EmbedBuilder()
                        .setColor(COLOR_WAITING) // Blue color.
                        .setTitle(`New Raid Request by: ${interaction.member.displayName}`)
                        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                        .addFields(
                            { name: 'Task(s)', value: resolvedTaskString, inline: false },
                            { name: 'Map Name', value: mapName, inline: true },
                            { name: 'Server', value: server, inline: true },
                            { name: 'Status', value: 'Waiting', inline: true },
                            { name: 'Description', value: description || 'No description provided.' },
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Last updated: ' });

                    // Send the embed and buttons to the new ticket channel
                    const sentMessage = await raidTicketChannel.send({
                        embeds: [embedMessage],
                        content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}`,
                    });

                    // send message to the newly created raid ticket
                    await raidTicketChannel.send({
                        content:`To update the status, type **!waiting**, **!ongoing** or **!full** in this channel.\nTo cancel, press the close raid and type **cancel**`,
                        components: [threadActionRow]
                    });

                    // pin the embed message
                    await sentMessage.pin(); 					

                    // Store the raid's information in the database.
                    await createRaid(raidTicketChannel.id, { 
                        messageId: sentMessage.id, 
                        originalChannelId: raidTicketChannel.id, 
                        task: resolvedTaskString,
                        requesterId: interaction.user.id,
                        mapName: mapName,
                        server: server,
                        description: description,
                        status: 'active', 
                        color: COLOR_WAITING, 
                        awaitingCompletion: false, 
                        originalName: baseChannelName, 
                    });
                    console.log(`Raid ticket channel created and stored in DB: ${raidTicketChannel.id} for task ${rawTaskInput} (resolved to ${resolvedTaskString}) by ${interaction.user.tag}`);

                    await interaction.reply({ content: `Your raid request has been submitted! Check out your new raid ticket: <#${raidTicketChannel.id}>`, flags: MessageFlags.Ephemeral });

                } catch (error) {
                    console.error('Error handling modal submission and creating raid ticket channel:', error);
                    await interaction.reply({ content: 'There was an error processing your request and creating the raid ticket. Please try again later.', flags: MessageFlags.Ephemeral });
                }
            }
        }
    });
}
