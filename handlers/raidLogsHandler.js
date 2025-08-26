// handlers/raidLogsHandler.js
// This file contains handlers for creating raid requests (now as new channels/tickets),
// managing raid status updates by renaming the channel,
// displaying boss mechanics charts within raid tickets, and showing raid task EXP points.

// Import necessary Discord.js components for UI elements like buttons, modals, embeds.
import {
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    TextChannel, 
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType 
} from 'discord.js';

// Import constants related to channel IDs, role IDs, task lists, and points configuration
import {
    RAID_CHANNEL_ID, // This will be the parent category for new ticket channels
    RAID_LOGS_CHANNEL_ID, // Still used for a public log/announcement if desired
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
    RECORD_HOLDER_ROLE_ID,
    RAID_CATEGORY_ID
} from '../config/constants.js';

// Import shared state and functions from activeRaidState.js for managing active raid tickets.
import {
    updateRaidStatus, // This will be modified to rename channels
    getRaidInfo,
    createRaid,
    updateRaid // Added for updating raid details if needed
} from '../activeRaidState.js';
import { getCombinedTasksAndPointsEmbed } from './generalCommandsHandler.js';

// --- Utility Functions ---
/**
 * Checks if a message author has an admin role.
 * @param {import('discord.js').Message | import('discord.js').Interaction} source The message or interaction to check.
 * @returns {boolean} True if the user has an admin role, false otherwise.
 */
function isAdmin(source) {
    if (!source.member) {
        console.warn('isAdmin called for a source without a member object (e.g., DM).');
        return false;
    }
    return (
        source.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        source.member.roles.cache.has(OFFICER_ROLE_ID) ||
        source.member.roles.cache.has(RAID_MANAGER_ROLE_ID) ||
        source.member.roles.cache.has(RAID_CHAMPION_ROLE_ID) ||
        source.member.roles.cache.has(RECORD_HOLDER_ROLE_ID)
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
 * Sets up event handlers for raid logging functionalities, including raid requests (now as channels),
 * status updates within channels, and boss mechanic charts in channels.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export function setupRaidLogsHandlers(client) {
    // --- Message Create Listener (for commands and status updates within channels) ---
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return; // Ignore messages from bots.

        // Check if the message is in a raid ticket channel (not a main channel or general thread)
        // A raid ticket channel's ID will be stored in our DB.
        const raidInfo = await getRaidInfo(message.channel.id);
        const isRaidTicketChannel = raidInfo && message.channel.type === ChannelType.GuildText && message.channel.parentId === RAID_CATEGORY_ID;


        if (isRaidTicketChannel) {
            const content = message.content.toLowerCase().trim();
            let newStatusTag = ''; // e.g., '[waiting]'
            let newColor = 0x0099ff; // Default blue

            if (content === '!waiting') {
                newStatusTag = '[waiting]';
                newColor = 0x0099ff;
            } else if (content === '!full') {
                newStatusTag = '[full]';
                newColor = 0xdd2e44;
            } else if (content === '!ongoing') {
                newStatusTag = '[ongoing]';
                newColor = 0x78b159;
            }

            if (newStatusTag) {
                try {
                    // Fetch the guild member using the requesterId from raidInfo
                    const requesterMember = await message.guild.members.fetch(raidInfo.requesterId);
                    if (!requesterMember) {
                        await message.channel.send('Could not find the original raid requester to update the channel name.');
                        return;
                    }

                    // Construct the base name using the requester's display name
                    const baseName = `${requesterMember.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
                    const newChannelName = `${baseName}-${newStatusTag}`;

                    await message.channel.setName(newChannelName, `Status change to ${newStatusTag}`);
                    // Update the raid status in the database (this still makes sense for internal state)
                    await updateRaid(message.channel.id, { status: newStatusTag, color: newColor });
                    await message.react('👍');
                    return;
                } catch (error) {
                    console.error(`Error renaming channel ${message.channel.id}:`, error);
                    await message.channel.send('Failed to update channel name. Ensure the new name is valid and within Discord\'s length limits (100 characters).');
                }
            }
        }

        // --- Logic for boss mechanic charts within any raid ticket channel ---
        if (isRaidTicketChannel) {
            const channelCommand = message.content.toLowerCase().trim();
            let embedToSend;
            let messageContent = null;

            // Check for specific chart commands and create the corresponding embed.
            if (channelCommand === '!1man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('1-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/svrjfx.jpg')
                    .setFooter({ text: 'Speaker chart for 1-man taunts' });
            } else if (channelCommand === '!2man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('2-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/hvccl7.png')
                    .setFooter({ text: 'Speaker chart for 2-man taunts by Veritus' });
                messageContent = "It's movie time <@114514543899705351>"; //ping Veritus
            } else if (channelCommand === '!3man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('3-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/5x4grv.jpg')
                    .setFooter({ text: 'Speaker chart for 3-man taunts' });
            } else if (channelCommand === '!4man') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('4-Man Speaker Chart')
                    .setImage('https://files.catbox.moe/yi71zh.jpg')
                    .setFooter({ text: 'Speaker chart for 4-man taunts' });
            } else if (channelCommand === '!gramielchart') {
                embedToSend = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('Gramiel Chart')
                    .setImage('https://files.catbox.moe/esowjk.png')
                    .setFooter({ text: 'Gramiel chart made by Lilicht' });
            }

            if (embedToSend) {
                try {
                    await message.channel.send({ content: messageContent, embeds: [embedToSend] });
                } catch (error) {
                    console.error(`Error sending ${channelCommand} chart:`, error);
                    await message.channel.send('Failed to send the chart. Please check the link or try again later.');
                }
            }
        }

        // --- Handle !raidmaps without a number ---
        if (message.content.toLowerCase().trim() === '!raidmaps') {
            if (isRaidTicketChannel) {
                await message.channel.send('Please provide the map number. Example: `!raidmaps 7070`');
            } else {
                await message.channel.send('The `!raidmaps [number]` command can only be used inside an active raid ticket channel to get join links for the tasks in that specific raid.');
            }
            return;
        }

        // --- Handle the !raidmaps <number> command ---
        const raidMapsMatch = message.content.toLowerCase().match(/^!raidmaps\s+(\d+)$/);

        if (raidMapsMatch) {
            const mapNumber = raidMapsMatch[1];

            if (isRaidTicketChannel && raidInfo) {
                const raidTasksString = raidInfo.task;
                const rawRequestedTasks = raidTasksString.split(/\s*\+\s*/).map(t => t.trim());

                let expandedTasks = [];
                for (const task of rawRequestedTasks) {
                    if (TASK_MAP_CATEGORIES[task]) {
                        expandedTasks = expandedTasks.concat(TASK_MAP_CATEGORIES[task]);
                    } else {
                        expandedTasks.push(task);
                    }
                }

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
                console.error('Error sending !raidsite embed:', error);
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
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton() && !interaction.isModalSubmit()) {
            return;
        }

        // --- Handle Modal Submissions ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'raidRequestModal') {
                const task = interaction.fields.getTextInputValue('taskInput').toLowerCase();
                const mapName = interaction.fields.getTextInputValue('mapNameInput');
                const server = interaction.fields.getTextInputValue('serverInput');
                const description = interaction.fields.getTextInputValue('descriptionInput');

                const requestedTasks = task.split(/\s*\+\s*/).map(t => t.trim());
                for (const singleTask of requestedTasks) {
                    if (!ALLOWED_TASK_NAMES.includes(singleTask)) {
                        await interaction.reply({
                            content: `Invalid task "${singleTask}". Please use one of the allowed tasks below. If requesting multiple, separate with '+'.`,
                            embeds: [getCombinedTasksAndPointsEmbed()],
                            ephemeral: true
                        });
                        return;
                    }
                }

                await interaction.deferReply({ ephemeral: true }); // Defer immediately for longer processing

                try {
                    const guild = interaction.guild;
                    if (!guild) {
                        await interaction.editReply({ content: 'Error: This command can only be used in a server.' });
                        return;
                    }

                    // Create the new raid ticket channel
                    // Name: requester-raid-request-[status]
                    const baseChannelName = `${interaction.member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;
                    const initialChannelName = `${baseChannelName}-[waiting]`;

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
                        .setColor(0x0099ff) // Blue color.
                        .setTitle(`New Raid Request by: ${interaction.member.displayName}`)
                        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                        .addFields(
                            { name: 'Task(s)', value: task, inline: false },
                            { name: 'Map Name', value: mapName, inline: true },
                            { name: 'Server', value: server, inline: true },
                            { name: 'Description', value: description || 'No description provided.' },
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Raid Request System' });

                    // Send the embed and buttons to the new ticket channel
                    const sentMessage = await raidTicketChannel.send({
                        embeds: [embedMessage],
                        content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}\n\nTo update the status, type **!waiting**, **!ongoing** or **!full** in this channel.`,
                        components: [threadActionRow]
                    });

                    // Store the raid's information in the database.
                    await createRaid(raidTicketChannel.id, { // Use channelId as the primary ID
                        messageId: sentMessage.id, // The ID of the initial embed message in the ticket channel
                        originalChannelId: raidTicketChannel.id, // This ticket channel itself is the 'original'
                        task: task,
                        requesterId: interaction.user.id,
                        mapName: mapName,
                        server: server,
                        description: description,
                        status: initialChannelName, // Store the initial status tag
                        color: 0x0099ff, // Store initial color
                        awaitingCompletion: false
                    });
                    console.log(`Raid ticket channel created and stored in DB: ${raidTicketChannel.id} for task ${task} by ${interaction.user.tag}`);

                    await interaction.editReply({ content: `Your raid request has been submitted! Check out your new raid ticket: <#${raidTicketChannel.id}>`, ephemeral: true });

                } catch (error) {
                    console.error('Error handling modal submission and creating raid ticket channel:', error);
                    await interaction.editReply({ content: 'There was an error processing your request and creating the raid ticket. Please try again later.', ephemeral: true });
                }
            }
        }
    });
}