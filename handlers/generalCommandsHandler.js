// handlers/generalCommandsHandler.js
import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { RAID_CHANNEL_ID, RAID_HELPER_ROLE_ID, LEADERBOARD_CHANNEL_ID, RAID_MANAGEMENT_CHANNEL_ID, MAX_XP_PER_RAID, POINTS_CONFIG, TASK_MAP_CATEGORIES } from '../config/constants.js';
import { getTasksEmbed, getRaidRequestModal } from './raidLogsHandler.js'; 

// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
// Stores references to cooldown warning messages for later deletion
const cooldownWarningMessages = new Map();
// Cooldown duration in milliseconds (e.g., 10 seconds)
const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- Custom GIF Commands (for embeds) ---
const gifCommands = {
    'the most beautiful thing you will ever see': {
        title: 'The Most Beautiful Thing You will Ever See',
        image: 'https://files.catbox.moe/5tsmuk.gif',
        footer: 'Feast your eyes on this',
        color: 0xFF0000
    },
    'i need more bullets': {
        title: "Asta La Vista, Baby",
        image: 'https://files.catbox.moe/dnzecs.gif',
        footer: 'He needs more bullets',
        color: 0x006400
    },
    'sybau xychrome': {
        title: "Get Twerked On",
        image: 'https://files.catbox.moe/neo4gz.gif',
        footer: 'Sybauuuu',
        color: 0x7e7e7e
    },
    "let's get freaky": {
        title: "im about to get freaky",
        image: 'https://files.catbox.moe/0n1mp7.gif',
        footer: 'spurt spurt',
        color: 0x48757d
    },
    "the scariest thing you will ever see": {
        title: "BOO!",
        image: 'https://files.catbox.moe/3l3wtr.png',
        footer: 'Time to stop procrastinating and get a job',
        color: 0x1a1a1e
    },
    "shaboingboing": {
        title: "You gotta give him that Hawk Tuah",
        image: 'https://files.catbox.moe/qy74ka.gif',
        footer: 'Gawk gawk gawk',
        color: 0xaa8f7d
    }
};

// --- Custom TEXT GIF Commands (no embeds) ---
const textGifCommands = {
    'acefart': '<@467703633618796544> [**ALWAYS AT FAURLT**](https://files.catbox.moe/chroap.gif)', // 467703633618796544
    'xyfart': '<@965985831649169438> [**BABAGAN MENYANG**](https://files.catbox.moe/kyqp98.gif)',  // 965985831649169438
    'marfart': '<@1030038861851664404> [**MISS MARA**](https://files.catbox.moe/xwpnq5.gif)',       // 1030038861851664404
    'marbike': '<@1030038861851664404> [**RIDE TO THE HARAM LAND WHERE I BELONG**](https://files.catbox.moe/ayl6ui.gif)', // 1030038861851664404
    'ahranus': '<@745959520622346260> [**THIS IS NOT PAINLESS LIKE KEVIN SAID AHHHHHH**](https://files.catbox.moe/och1y0.gif)' // 745959520622346260
};


/**
 * Sets up the handler for general bot commands and interactions,
 * including the !raidcommands list, custom GIF triggers, and the "Get Help Role" button.
 * @param {Client} client The Discord client instance.
 */
export function setupGeneralCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const commandContent = message.content.toLowerCase();

        // --- Handle the !raidcommands command ---
        if (commandContent === '!raidcommands' && message.channel.id === RAID_CHANNEL_ID) {
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
\`!raidtasks\`: Lists all available raid tasks **by category**.
\`!raidpoints\`: Displays the EXP values for all configured raid tasks
\`!calculatetask <task1> + <task2> + ...\`: Calculates total points for specified tasks.
                        \n`
                    },
                    {
                        name: '⚔️ Commands Inside Raid Threads',
                        value: `
\`!raidmaps [number]\`: Displays the map's specified in the raid to make joining maps easier.
\`!raidsite\`: Sends a website for making joining maps easier.
\`!waiting\`: Set the raid status to '🔵 Waiting (requester only)'.
\`!ongoing\`: Set the raid status to '🟢 Ongoing (requester only)'.
\`!full\`: Set the raid status to '🔴 Full (requester only)'.
\`!1man\`: Displays the 1-man taunt chart for ultraspeaker.
\`!2man\`: Displays the 2-man taunt chart for ultraspeaker.
\`!3man\`: Displays the 3-man taunt chart for ultraspeaker.
\`!4man\`: Displays the 4-man taunt chart for ultraspeaker.
\`!gramielchart\`: Displays the chart for ultragramiel.
                        \n`
                    },
                    {
                        name: '💬 Commands for closing the Raid Request',
                        value: `
\`cancel\`: Close the raid thread without awarding points.
\`all = @user1 @user2\`: Awards EXP for all tasks in the original raid request to the tagged player(s).
\`taskname = @user1 @user2\`: Awards EXP for a specific task to tagged player(s).
\`taskname + taskname = @user1\`: Awards EXP for multiple tasks to the tagged player(s).
\`xN\` =  \`taskname xN = @user1\`: Awards EXP with a multiplier for multiple runs to the tagged player(s).
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

            try {
                await message.channel.send({ embeds: [commandsEmbed], components: [commandButtonsRow] });
            } catch (error) {
                console.error('Error sending !raidcommands embed:', error);
                await message.channel.send('Failed to display commands. Please try again later.');
            }
        }

        // --- Handle the !calculatetask command ---
        if (commandContent.startsWith('!calculatetask')) {
            const args = message.content.slice('!calculatetask'.length).trim();
            const taskNames = args.split('+').map(task => task.trim().toLowerCase()).filter(task => task.length > 0);

            if (taskNames.length === 0) {
                return message.reply({ content: 'Usage: `!calculatetask <task1> + <task2> + ...` (e.g., `!calculatetask speaker + mechabinky`)', ephemeral: true });
            }

            let originalTotalCalculatedPoints = 0;
            const unknownTasks = [];

            for (const taskName of taskNames) {
                // Check if it's a meta category
                if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
                    const categoryTasks = TASK_MAP_CATEGORIES[taskName];
                    for (const individualTask of categoryTasks) {
                        if (POINTS_CONFIG.hasOwnProperty(individualTask)) {
                            originalTotalCalculatedPoints += POINTS_CONFIG[individualTask];
                        } else {
                            // This case should ideally not happen if POINTS_CONFIG is comprehensive
                            console.warn(`Task "${individualTask}" from category "${taskName}" not found in POINTS_CONFIG.`);
                            unknownTasks.push(individualTask);
                        }
                    }
                } else if (POINTS_CONFIG.hasOwnProperty(taskName)) {
                    // If not a meta category, check if it's a direct task name in POINTS_CONFIG
                    originalTotalCalculatedPoints += POINTS_CONFIG[taskName];
                } else {
                    // If neither a meta category nor a direct task name
                    unknownTasks.push(taskName);
                }
            }

            // Apply the 20-point cap to the calculated total
            let totalCalculatedPoints = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);

            let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP`;

            if (unknownTasks.length > 0) {
                replyContent += `\n\n_Note: The following tasks were not recognized and were not included in the calculation: ${unknownTasks.join(', ')}._`;
            }
            // Corrected condition for displaying the capping message
            if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
                replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP._`;
            }

            await message.reply({ content: replyContent, ephemeral: true });
            return;
        }


        // --- Handle the !commandslb command ---
        if (commandContent === '!lbcommands' && message.channel.id === LEADERBOARD_CHANNEL_ID) {
            const leaderboardCommandsEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // A different color for distinction, e.g., green
                .setTitle('🏆 Leaderboard Commands List 🏆')
                .setDescription('this is shown using `!lbcommands`. \nHere are the commands to check raid experience and rankings:')
                .addFields(
                    {
                        name: 'Leaderboard & Points Check',
                        value: `
\`!leaderboard\` or \`!lb\`: Displays the current top 10 players by total EXP.
\`!lbcheck [@user] [today/yesterday/day# |-MM-DD | from <start> to <end>]\`: Shows EXP gained on a specific day or date range (overall or for specific user(s)).
**Example: \`!lbcheck @user1 @user2 from 10 to 15\`**
                        `
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Raid Helper Bot | Leaderboard Commands' });

            try {
                await message.channel.send({ embeds: [leaderboardCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !commandslb embed:', error);
                await message.channel.send('Failed to display leaderboard commands. Please try again later.');
            }
        }

        // --- handle the moderator commands ---
        if (commandContent === '!modcommands' && message.channel.id === RAID_MANAGEMENT_CHANNEL_ID) {
            const leaderboardCommandsEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // A different color for distinction, e.g., green
                .setTitle('🛡️ Moderator Commands List 🏆')
                .setDescription('this is shown using `!modcommands`. \nHere are the commands for moderation:')
                .addFields(
                    {
                        name: ' Moderator Commands (Administrator/Officer/Manager Only)',
                        value: `
\`!addxp @user @user <amount>\`: Manually adds EXP to a specified user.
\`!removexp @user @user <amount>\`: Manually removes EXP from a specified user.
\`!resetlb [all]\`: Resets the leaderboard (monthly automatic or force with \`all\`).
\`!lbackup\`: Forces the bot to upload a new leaderboard backup and replace the old one.
\`!restorelb\`: Restores the leaderboard from an attached \`leaderboard.json\` file.
                        `
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Raid Helper Bot | Leaderboard Commands' });

            try {
                await message.channel.send({ embeds: [leaderboardCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !commandslb embed:', error);
                await message.channel.send('Failed to display leaderboard commands. Please try again later.');
            }
        }

        // --- Handle !secretcommands to list all GIF commands ---
        if (commandContent === '!secretcommands') {
            let secretGifCommandsList = '';
            // Add commands from gifCommands (embeds)
            for (const cmd in gifCommands) {
                secretGifCommandsList += `* \`${cmd}\`\n`;
            }
            // Add commands from textGifCommands (no embeds)
            for (const cmd in textGifCommands) {
                secretGifCommandsList += `* \`${cmd}\`\n`;
            }

            const secretCommandsEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // Pink color for secret commands
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
            try {
                await message.channel.send({ embeds: [secretCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !secretcommands embed:', error);
                await message.channel.send('Failed to display secret Gif commands. Please try again later.');
            }
        }

        // --- Consolidated Custom GIF Commands Handling ---
        const userId = message.author.id;
        const now = Date.now();
        const lastUsed = gifCooldowns.get(userId);

        // Apply cooldown check before processing any GIF command
        if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
            const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
            const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

            // If there's an existing cooldown warning message, try to delete it first
            const existingWarningMessage = cooldownWarningMessages.get(userId);
            if (existingWarningMessage) {
                try {
                    await existingWarningMessage.delete();
                } catch (err) {
                    console.error(`Error deleting old cooldown warning message for user ${userId}:`, err);
                } finally {
                    cooldownWarningMessages.delete(userId); // Always clear the old reference
                }
            }

            // Send the new cooldown warning message
            const warningMessage = await message.reply({ content: cooldownMessageContent });
            cooldownWarningMessages.set(userId, warningMessage);

            // Set a timeout to delete the warning message when the cooldown expires
            setTimeout(async () => {
                const currentWarningMessage = cooldownWarningMessages.get(userId);
                // Only delete if it's the same message (i.e., user hasn't sent another command)
                if (currentWarningMessage && currentWarningMessage.id === warningMessage.id) {
                    try {
                        await currentWarningMessage.delete();
                    } catch (err) {
                        // Ignore "Unknown Message" error if it was already deleted by user or Discord
                        if (err.code !== 10008) { // 10008 is Unknown Message
                            console.error(`Error deleting cooldown warning message for user ${userId}:`, err);
                        }
                    } finally {
                        cooldownWarningMessages.delete(userId); // Clear after attempt to delete
                    }
                }
            }, GIF_COOLDOWN_DURATION);

            return; // Exit if still on cooldown
        }

        // Check for regular gif commands (with embeds)
        if (gifCommands[commandContent]) {
            gifCooldowns.set(userId, now); // Set cooldown only if a command is found

            // If there was a pending cooldown warning message, delete it immediately
            const existingWarningMessage = cooldownWarningMessages.get(userId);
            if (existingWarningMessage) {
                try {
                    await existingWarningMessage.delete();
                } catch (err) {
                    if (err.code !== 10008) {
                        console.error(`Error deleting cooldown warning message after successful GIF command for user ${userId}:`, err);
                    }
                } finally {
                    cooldownWarningMessages.delete(userId);
                }
            }

            const gifInfo = gifCommands[commandContent];
            const gifEmbed = new EmbedBuilder()
                .setColor(gifInfo.color)
                .setTitle(gifInfo.title)
                .setImage(gifInfo.image)
                .setFooter({ text: gifInfo.footer });
            try {
                await message.channel.send({ embeds: [gifEmbed] });
            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }
        // Check for text gif commands (no embeds)
        else if (textGifCommands[commandContent]) {
            gifCooldowns.set(userId, now); // Set cooldown only if a command is found

            // If there was a pending cooldown warning message, delete it immediately
            const existingWarningMessage = cooldownWarningMessages.get(userId);
            if (existingWarningMessage) {
                try {
                    await existingWarningMessage.delete();
                } catch (err) {
                    if (err.code !== 10008) {
                        console.error(`Error deleting cooldown warning message after successful TEXT GIF command for user ${userId}:`, err);
                    }
                } finally {
                    cooldownWarningMessages.delete(userId);
                }
            }

            try {
                await message.channel.send(textGifCommands[commandContent]);
            } catch (error) {
                console.error(`Error sending text GIF command "${commandContent}":`, error);
                await message.channel.send('Could not send the requested GIF message.');
            }
        }

    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        switch (interaction.customId) {
            case 'getHelpRole_btn':
                // --- Logic to assign/remove RAID_HELPER_ROLE_ID to/from the user ---
                const guild = interaction.guild;
                const member = interaction.member;

                if (!guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
                    return;
                }

                try {
                    const role = await guild.roles.fetch(RAID_HELPER_ROLE_ID);
                    if (!role) {
                        await interaction.reply({ content: 'The specified helper role was not found. Please contact an administrator.', ephemeral: true });
                        return;
                    }

                    const botMember = await guild.members.fetch(client.user.id);
                    if (!botMember.permissions.has('ManageRoles')) {
                        await interaction.reply({ content: 'I do not have the necessary permissions (`Manage Roles`) to assign roles. Please ask an administrator to grant me this permission.', ephemeral: true });
                        return;
                    }
                    if (botMember.roles.highest.position <= role.position) {
                        await interaction.reply({ content: `My role is not high enough to assign the \`${role.name}\` role. Please ensure my role is above the helper role in the server settings.`, ephemeral: true });
                        return;
                    }

                    if (member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                        await member.roles.remove(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');
                        await interaction.reply({ content: `Your \`${role.name}\` role has been removed! You will no longer get pinged for new raid requests `, ephemeral: true });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');
                        await interaction.reply({ content: `You have been given the \`${role.name}\` role! You will now get pinged for new raid requests`, ephemeral: true });
                    }

                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', ephemeral: true });
                }
                break;
            case 'startRaid_btn':
                // This button interaction should be handled here to open the raid request modal.
                const raidModal = getRaidRequestModal();
                await interaction.showModal(raidModal);
                break;
            case 'seeRaidTasks_btn':
                // This button interaction should be handled here to display the raid tasks embed.
                const tasksEmbed = getTasksEmbed();
                await interaction.reply({ embeds: [tasksEmbed], ephemeral: true });
                break;
            case 'howToUse_btn':
                // This button interaction should be handled here to display the how-to-use embed.
                let raidHelperRoleName = 'unknown Role';
                if (interaction.guild) {
                    try {
                        const role = await interaction.guild.roles.fetch(RAID_HELPER_ROLE_ID);
                        if (role) {
                            raidHelperRoleName = role.name;
                        }
                    } catch (error) {
                        console.error('Error fetching RAID_HELPER_ROLE_ID name:', error);
                    }
                }
                const howToUse_embed = new EmbedBuilder()
                    .setTitle('📜 How to Use the Raid Helper Bot')
                    .setDescription(
                        `**1. Request a Raid:** Go to the <#${RAID_CHANNEL_ID}> channel and click the \`⚔️ Start Raid\` button. Fill out the form. Only tasks listed in \`📋 See Raid Tasks\` button will be accepted.` +
                        `\nfor tasks not included in the list you can use the following generic tasks:\n` +
                        `   • \`simple\`: Raids expected to take less than 5 to 10 minutes.\n` +
                        `   • \`moderate\`: Raids expected to take less than 30 minutes.\n` +
                        `   • \`hard\`: Raids expected to take 30 minutes or more.\n` +
                        `   • **Note**: don't forget to describe your request in the description field when necessary.\n` +
                        `**2. Raid Coordination:** A dedicated thread will be created for your raid in the raid logs channel. Use it to communicate with helpers.\n\n` +
                        `**3. Update Status:** In your raid thread, you (the requester) can type \`!waiting\`, \`!ongoing\` or \`!full\` to update the raid's status in the main log. You can also use the \`✏️ Edit Task\` Button to edit your raid request\n\n` +
                        `**4. Complete Raid:** Once the raid is done, click the \`🔒 Close Raid\` button in your thread. You'll then be prompted to tag your helpers (e.g., \`all x2 = @user1 @user2\` or \`task1 + task2 = @user3\`) and optionally attach a screenshot or typing \`cancel\` to close the raid. \`Only tasks listed in your raid request (or edited tasks) will award points.\`\n\n` +
                        `**5. Check Points:** Use \`!leaderboard\` or \`!lb\`to see top players or \`!lbcheck\` to see your daily EXP. There is a limit of \`${MAX_XP_PER_RAID} EXP\` per raid.\n\n`
                    )
                    .setColor(0x3498DB);

                await interaction.reply({
                    embeds: [howToUse_embed],
                    ephemeral: true
                });
                break;
            default:
                console.log(`Unhandled button interaction customId: ${interaction.customId}`);
                break;
        }
    });
}
