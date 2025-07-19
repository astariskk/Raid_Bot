import { REST, Routes, ApplicationCommandOptionType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
// Import necessary constants from config/constants.js
import {
    RAID_CHANNEL_ID,
    LEADERBOARD_CHANNEL_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
    MAX_XP_PER_RAID,
    POINTS_CONFIG,
    TASK_MAP_CATEGORIES,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_HELPER_ROLE_ID // Needed for /raidcommands embed
} from '../config/constants.js';
// Import functions from raidLogsHandler.js
import { getTasksEmbed, getRaidRequestModal } from './raidLogsHandler.js';
// Import GIF constants from generalCommandsHandler.js
import { gifCommands, textGifCommands } from './generalCommandsHandler.js'; // NEW IMPORT - ensure generalCommandsHandler exports these

// Define your slash commands
const commands = [
    {
        name: 'ping',
        description: 'Checks if the bot is running!',
    },
    {
        name: 'echo',
        description: 'Repeats your message back to you.',
        options: [
            {
                name: 'message',
                description: 'The message to echo.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'userinfo',
        description: 'Displays information about a user.',
        options: [
            {
                name: 'user',
                description: 'The user to get info about (defaults to yourself).',
                type: ApplicationCommandOptionType.User,
                required: false,
            },
        ],
    },
    {
        name: 'serverinfo',
        description: 'Displays information about the server.',
    },
    {
        name: 'raidcommands',
        description: 'Displays a list of general raid helper commands and interaction buttons.',
    },
    {
        name: 'calculatetask',
        description: 'Calculates total EXP for specified raid tasks.',
        options: [
            {
                name: 'tasks',
                description: 'Enter tasks separated by "+", e.g., "speaker + mechabinky".',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'lbcommands',
        description: 'Displays a list of leaderboard and EXP check commands.',
    },
    {
        name: 'modcommands',
        description: 'Displays a list of moderator-only commands for leaderboard management.',
    },
    {
        name: 'secretcommands',
        description: 'Displays a list of secret GIF commands.',
    },
];

/**
 * Registers slash commands with Discord's API.
 * This function should be called once when the bot starts.
 * @param {Client} client The Discord client instance.
 */
export async function registerSlashCommands(client) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.time('Slash Command Registration API Call'); // Start timer for API call
        console.log('Started refreshing application (/) commands.');
        // Register commands globally. For specific guilds, use Routes.applicationGuildCommands(clientId, guildId)
        await rest.put(
            Routes.applicationCommands(client.user.id), // Global commands
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
        console.timeEnd('Slash Command Registration API Call'); // End timer
    } catch (error) {
        console.error('Error refreshing application (/) commands:', error);
    }
}

/**
 * Helper function to check if a member has admin/moderator roles.
 * @param {GuildMember} member The guild member to check.
 * @returns {boolean} True if the member has any of the required roles, false otherwise.
 */
function hasAdminPermissions(member) {
    if (!member) return false;
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

/**
 * Calculates the total points for a given set of tasks.
 * Handles meta-tasks like 'daily', 'weekly', 'templeshrine', and 'originul'.
 * This function is duplicated from generalCommandsHandler to keep the logic self-contained for the slash command.
 * @param {string[]} tasks - An array of task names.
 * @returns {number} The total points.
 */
function calculateTaskPointsForSlashCommand(tasks) {
    let originalTotalCalculatedPoints = 0;

    for (const taskName of tasks) {
        if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
            const categoryTasks = TASK_MAP_CATEGORIES[taskName];
            for (const individualTask of categoryTasks) {
                if (POINTS_CONFIG.hasOwnProperty(individualTask)) {
                    originalTotalCalculatedPoints += POINTS_CONFIG[individualTask];
                }
            }
        } else if (POINTS_CONFIG.hasOwnProperty(taskName)) {
            originalTotalCalculatedPoints += POINTS_CONFIG[taskName];
        }
    }
    return Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);
}


/**
 * Sets up the interaction listener for slash commands.
 * This function should be called once when the bot starts.
 * @param {Client} client The Discord client instance.
 */
export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async interaction => {
        // Only handle chat input commands
        if (!interaction.isChatInputCommand()) return;

        // NEW LOGS: More detailed logging around deferral attempt
        console.log(`[Interaction] Received command: /${interaction.commandName} (ID: ${interaction.id})`);
        console.log(`[Interaction] isReplied: ${interaction.replied}, isDeferred: ${interaction.deferred}`);
        console.time(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);

        // Defer reply for commands that might take longer, or for conditional ephemeral replies
        // Use flags instead of ephemeral for deprecation warning fix
        try {
            await interaction.deferReply({ flags: [] }); // Default to public, can be overridden
            console.timeEnd(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);
            console.log(`[Interaction] Successfully deferred /${interaction.commandName} (ID: ${interaction.id})`);
        } catch (error) {
            console.timeEnd(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);
            console.error(`[Interaction Error] Failed to defer reply for /${interaction.commandName} (ID: ${interaction.id}):`, error);
            // If deferral fails, it means Discord has already invalidated the interaction.
            // We cannot reply or followUp to it anymore.
            return; // Exit here to prevent further errors
        }

        switch (interaction.commandName) {
            case 'ping':
                try {
                    await interaction.editReply('Bot is running!');
                } catch (error) {
                    console.error('Error replying to ping command:', error);
                    // Fallback to followUp if initial reply fails, or just log
                    if (!interaction.replied && !interaction.deferred) { // This check is now mostly redundant after deferReply try/catch
                        await interaction.followUp({ content: 'There was an error trying to respond to this command.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            case 'echo':
                try {
                    const messageToEcho = interaction.options.getString('message');
                    await interaction.editReply({ content: messageToEcho });
                } catch (error) {
                    console.error('Error replying to echo command:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error trying to echo your message.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            case 'userinfo':
                try {
                    const targetUser = interaction.options.getUser('user') || interaction.user;
                    const member = interaction.guild ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;

                    const userInfoEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(`User Info: ${targetUser.username}`)
                        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: 'Username', value: targetUser.username, inline: true },
                            { name: 'Discriminator', value: targetUser.discriminator === '0' ? 'None' : targetUser.discriminator, inline: true },
                            { name: 'ID', value: targetUser.id, inline: false },
                            { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                            { name: 'Created At', value: targetUser.createdAt.toDateString(), inline: true }
                        )
                        .setTimestamp();

                    if (member) {
                        userInfoEmbed.addFields(
                            { name: 'Nickname', value: member.nickname || 'None', inline: true },
                            { name: 'Joined Server At', value: member.joinedAt ? member.joinedAt.toDateString() : 'N/A', inline: true },
                            { name: 'Roles', value: member.roles.cache.map(role => role.name).join(', ') || 'None', inline: false }
                        );
                    }

                    await interaction.editReply({ embeds: [userInfoEmbed] });
                } catch (error) {
                    console.error('Error replying to userinfo command:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error trying to get user information.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            case 'serverinfo':
                try {
                    if (!interaction.guild) {
                        return await interaction.editReply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
                    }

                    const guild = interaction.guild;
                    const owner = await guild.fetchOwner();

                    const serverInfoEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(`Server Info: ${guild.name}`)
                        .setThumbnail(guild.iconURL({ dynamic: true }))
                        .addFields(
                            { name: 'Server Name', value: guild.name, inline: true },
                            { name: 'Server ID', value: guild.id, inline: true },
                            { name: 'Owner', value: owner ? owner.user.tag : 'N/A', inline: true },
                            { name: 'Members', value: guild.memberCount.toString(), inline: true },
                            { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
                            { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
                            { name: 'Created At', value: guild.createdAt.toDateString(), inline: true },
                            { name: 'Boost Level', value: guild.premiumTier.toString(), inline: true },
                            { name: 'Verification Level', value: guild.verificationLevel.toString(), inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [serverInfoEmbed] });
                } catch (error) {
                    console.error('Error replying to serverinfo command:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error trying to get server information.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            case 'raidcommands':
                try {
                    if (interaction.channel.id !== RAID_CHANNEL_ID) {
                        return await interaction.editReply({ content: `This command can only be used in the <#${RAID_CHANNEL_ID}> channel.`, flags: MessageFlags.Ephemeral });
                    }
                    const getHelpRoleButton = new ButtonBuilder()
                        .setCustomId('getHelpRole_btn')
                        .setLabel('📣 Get Help Role')
                        .setStyle(ButtonStyle.Secondary);

                    const startRaidButton = new ButtonBuilder()
                        .setCustomId('startRaid_btn')
                        .setLabel('⚔️ Start Raid')
                        .setStyle(ButtonStyle.Primary);

                    const seeRaidTasksButton = new ButtonBuilder()
                        .setCustomId('seeRaidTasks_btn')
                        .setLabel('📋 See Raid Tasks')
                        .setStyle(ButtonStyle.Secondary);

                    const howToUseButton = new ButtonBuilder()
                        .setCustomId('howToUse_btn')
                        .setLabel('❓ How to Use')
                        .setStyle(ButtonStyle.Secondary);

                    const commandButtonsRow = new ActionRowBuilder()
                        .addComponents(startRaidButton, getHelpRoleButton, seeRaidTasksButton, howToUseButton);

                    const commandsEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('✨ Bot Commands List ✨')
                        .setDescription('Here are the commands you can use with the Raid Helper Bot:')
                        .addFields(
                            {
                                name: '📊 General Raid & Status Commands',
                                value: `
                                    \`/raidtasks\`: Lists all available raid tasks **by category**.
                                    \`/raidpoints\`: Displays the EXP values for all configured raid tasks.
                                    \`/calculatetask <tasks>\`: Calculates total points for specified tasks.
                                    \n`
                            },
                            {
                                name: '⚔️ Commands Inside Raid Threads',
                                value: `
                                    \`/raidmaps <number>\`: Displays the map's specified in the raid to make joining maps easier.
                                    \`/raidsite\`: Sends a website for making joining maps easier.
                                    \`/waiting\`: Set the raid status to '🔵 Waiting (requester only)'.
                                    \`/ongoing\`: Set the raid status to '🟢 Ongoing (requester only)'.
                                    \`/full\`: Set the raid status to '🔴 Full (requester only)'.
                                    \`/1man\`: Displays the 1-man taunt chart for ultraspeaker.
                                    \`/2man\`: Displays the 2-man taunt chart for ultraspeaker.
                                    \`/3man\`: Displays the 3-man taunt chart for ultraspeaker.
                                    \`/4man\`: Displays the 4-man taunt chart for ultraspeaker.
                                    \`/gramielchart\`: Displays the chart for ultragramiel.
                                    \n`
                            },
                            {
                                name: '💬 Commands for closing the Raid Request',
                                value: `
                                    \`cancel\`: Close the raid thread without awarding points.
                                    \`all = @user1 @user2\`: Awards EXP for all tasks in the original raid request to the tagged player(s).
                                    \`taskname = @user1 @user2\`: Awards EXP for a specific task to tagged player(s).
                                    \`taskname + taskname = @user1\`: Awards EXP for multiple tasks to the tagged player(s).
                                    \`xN\` = \`taskname xN = @user1\`: Awards EXP with a multiplier for multiple runs to the tagged player(s).
                                    \n`
                            },
                            {
                                name: '**Press the buttons below to interact with the bot:**',
                                value: `
                                    \`⚔️ Start Raid\`: To request assistance for a raid.
                                    \`📣 Get Help Role\`: To opt-in/out of pings for new raid requests.
                                    \`📋 See Raid Tasks\`: To see a list of all recognized raid tasks.
                                    \`❓ How to Use\`: For detailed instructions on using the bot.
                                    \n`
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Raid Helper Bot | Your ultimate raid companion!' });

                    await interaction.editReply({ embeds: [commandsEmbed], components: [commandButtonsRow] });
                } catch (error) {
                    console.error('Error sending /raidcommands embed:', error);
                    await interaction.editReply('Failed to display commands. Please try again later.');
                }
                break;

            case 'calculatetask':
                try {
                    const tasksArg = interaction.options.getString('tasks');
                    const taskNames = tasksArg.split('+').map(task => task.trim().toLowerCase()).filter(task => task.length > 0);

                    if (taskNames.length === 0) {
                        return await interaction.editReply({ content: 'Usage: `/calculatetask <task1> + <task2> + ...` (e.g., `/calculatetask speaker + mechabinky`)', flags: MessageFlags.Ephemeral });
                    }

                    let originalTotalCalculatedPoints = 0;
                    const unknownTasks = [];

                    for (const taskName of taskNames) {
                        if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
                            const categoryTasks = TASK_MAP_CATEGORIES[taskName];
                            for (const individualTask of categoryTasks) {
                                if (POINTS_CONFIG.hasOwnProperty(individualTask)) {
                                    originalTotalCalculatedPoints += POINTS_CONFIG[individualTask];
                                } else {
                                    console.warn(`Task "${individualTask}" from category "${taskName}" not found in POINTS_CONFIG.`);
                                    unknownTasks.push(individualTask);
                                }
                            }
                        } else if (POINTS_CONFIG.hasOwnProperty(taskName)) {
                            originalTotalCalculatedPoints += POINTS_CONFIG[taskName];
                        } else {
                            unknownTasks.push(taskName);
                        }
                    }

                    let totalCalculatedPoints = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);

                    let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP`;

                    if (unknownTasks.length > 0) {
                        replyContent += `\n\n_Note: The following tasks were not recognized and were not included in the calculation: ${unknownTasks.join(', ')}._`;
                    }
                    if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
                        replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP._`;
                    }

                    await interaction.editReply({ content: replyContent, flags: MessageFlags.Ephemeral });
                } catch (error) {
                    console.error('Error handling /calculatetask command:', error);
                    await interaction.editReply({ content: 'Failed to calculate points. Please try again later.', flags: MessageFlags.Ephemeral });
                }
                break;

            case 'lbcommands':
                try {
                    if (interaction.channel.id !== LEADERBOARD_CHANNEL_ID) {
                        return await interaction.editReply({ content: `This command can only be used in the <#${LEADERBOARD_CHANNEL_ID}> channel.`, flags: MessageFlags.Ephemeral });
                    }
                    const leaderboardCommandsEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🏆 Leaderboard Commands List 🏆')
                        .setDescription('This is shown using `/lbcommands`. \nHere are the commands to check raid experience and rankings:')
                        .addFields(
                            {
                                name: 'Leaderboard & Points Check',
                                value: `
                                    \`/leaderboard\` or \`/lb\`: Displays the current top 10 players by total EXP.
                                    \`/lbcheck [@user] [today/yesterday/day# |-MM-DD | from <start> to <end>]\`: Shows EXP gained on a specific day or date range (overall or for specific user(s)).
                                    **Example: \`/lbcheck user:@user1 date:from 10 to 15\`**
                                    `
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Raid Helper Bot | Leaderboard Commands' });

                    await interaction.editReply({ embeds: [leaderboardCommandsEmbed] });
                } catch (error) {
                    console.error('Error sending /lbcommands embed:', error);
                    await interaction.editReply('Failed to display leaderboard commands. Please try again later.');
                }
                break;

            case 'modcommands':
                try {
                    if (!interaction.member || !hasAdminPermissions(interaction.member)) {
                        return await interaction.editReply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
                    }
                    if (interaction.channel.id !== RAID_MANAGEMENT_CHANNEL_ID) {
                        return await interaction.editReply({ content: `This command can only be used in the <#${RAID_MANAGEMENT_CHANNEL_ID}> channel.`, flags: MessageFlags.Ephemeral });
                    }

                    const moderatorCommandsEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🛡️ Moderator Commands List �')
                        .setDescription('This is shown using `/modcommands`. \nHere are the commands for moderation:')
                        .addFields(
                            {
                                name: 'Moderator Commands (Administrator/Officer/Manager Only)',
                                value: `
                                    \`/addxp <user> <amount>\`: Manually adds EXP to a specified user.
                                    \`/removexp <user> <amount>\`: Manually removes EXP from a specified user.
                                    \`/resetlb [all]\`: Resets the leaderboard (monthly automatic or force with \`all\`).
                                    \`/lbackup\`: Forces the bot to upload a new leaderboard backup and replace the old one.
                                    \`/restorelb\`: Restores the leaderboard from an attached \`leaderboard.json\` file.
                                    `
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Raid Helper Bot | Moderator Commands' });

                    await interaction.editReply({ embeds: [moderatorCommandsEmbed] });
                } catch (error) {
                    console.error('Error sending /modcommands embed:', error);
                    await interaction.editReply('Failed to display moderator commands. Please try again later.');
                }
                break;

            case 'secretcommands':
                try {
                    let secretGifCommandsList = '';
                    // Use the imported gifCommands and textGifCommands
                    for (const cmd in gifCommands) {
                        secretGifCommandsList += `* \`${cmd}\`\n`;
                    }
                    for (const cmd in textGifCommands) {
                        secretGifCommandsList += `* \`${cmd}\`\n`;
                    }

                    const secretCommandsEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🤫 Secret Gif Commands List 🤫')
                        .setDescription('**Note:** These commands are for fun and may not be suitable for all audiences. Use them at your own discretion:')
                        .addFields(
                            {
                                name: 'Secret GIF Commands',
                                value: secretGifCommandsList.trim() || 'No secret GIF commands configured.'
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Raid Helper Bot | Secret Gif Commands' });
                    await interaction.editReply({ embeds: [secretCommandsEmbed] });
                } catch (error) {
                    console.error('Error sending /secretcommands embed:', error);
                    await interaction.editReply('Failed to display secret Gif commands. Please try again later.');
                }
                break;

            default:
                console.log(`Unhandled slash command: ${interaction.commandName}`);
                // If the reply was deferred, edit it. Otherwise, followUp.
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral }).catch(e => console.error("Error editing unknown command reply:", e));
                } else {
                    await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral }).catch(e => console.error("Error replying to unknown command:", e));
                }
                break;
        }
    });
}
