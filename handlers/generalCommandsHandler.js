// handlers/generalCommandsHandler.js
import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { 
    RAID_CHANNEL_ID, 
    RAID_HELPER_ROLE_ID, 
    LEADERBOARD_CHANNEL_ID, 
    RAID_MANAGEMENT_CHANNEL_ID, 
    MAX_XP_PER_RAID, 
    POINTS_CONFIG, 
    TASK_MAP_CATEGORIES,
    DAILIES_LIST,
    WEEKLIES_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    OTHERS_LIST,
    GENERIC_TASKS_LIST
} from '../config/constants.js';
import { getRaidRequestModal } from './raidLogsHandler.js'; 

// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
const cooldownWarningMessages = new Map();
const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- User IDs to ban from specific commands ---
const BANNED_USERS_FOR_COMMANDS = {
    'marbike': ['719443918621638660'], // Kuro banned from 'marbike'
};

// --- Custom GIF Commands (for embeds) ---
export const gifCommands = {
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
        color: 0x1a1a1e
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
    },
    "we live we love we lie": {
        title: "We Live, We Love, We Lie",
        image: 'https://files.catbox.moe/d5h906.gif',
        footer: 'Smurf cat do be speaking faxx',
        color: 0x3498DB
    }
};

// --- Custom TEXT GIF Commands (no embeds) ---
export const textGifCommands = {
    'acefault': '<@467703633618796544> [**ALWAYS AT FAURLT**](https://files.catbox.moe/chroap.gif)', // Ace 467703633618796544
    'xyfart': '<@965985831649169438> [**BABAGAN MENYANG**](https://files.catbox.moe/kyqp98.gif)',   // xy 965985831649169438
    'marbike': '<@1030038861851664404> [**RIDE TO THE HARAM LAND WHERE I BELONG**](https://files.catbox.moe/ayl6ui.gif)', // Amarah 1030038861851664404
    'tiflick': '<@385804720612048899> [**CAN YOU BLOW MY WHISTLE BABY WHISTLE BABY**](https://files.catbox.moe/14qran.gif)', // Chaos 385804720612048899
    'xpcopter': '<@618790940290842625> [**How About This Bad Boy?**](https://files.catbox.moe/k41zjv.gif)', // xp 618790940290842625
    'kaerat': ' https://files.catbox.moe/1leclp.gif',  // kae
    'xytwerk': 'https://files.catbox.moe/4xeq5l.gif' // xy 
};


function formatTasksForEmbed(taskList, pointsConfig) {
    if (!taskList || taskList.length === 0) {
        return 'N/A';
    }
    return taskList.map(task => {
        const points = pointsConfig[task.toLowerCase()];
        return `\`${task}\`: ${points !== undefined ? `${points} EXP` : 'N/A'}`;
    }).join('\n');
}

function getCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB) // blue
        .setTitle('✨ Bot Commands List ✨')
        .setDescription('Here are the commands you can use with the Raid Helper Bot:')
        .addFields(
            {
                name: '📊 General Raid & Status Commands',
                value: `
\`!raidtasks\`: Lists all available raid tasks **by category**.
\`!calculatetask <task1> + <task2> + ...\`: Calculates total points for specified tasks.
`
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
`
            },
            {
                name: '💬 Commands for closing the Raid Request',
                value: `
\`cancel\`: Close the raid thread without awarding points.
\`=\` and \`:\` : Use these to separate tasks and tag helpers.
\`all = @user1 @user2\`: Awards EXP for all tasks requested in the raid to the tagged player(s).
\`taskname = @user1 @user2\`: Awards EXP for a specific task to tagged player(s).
\`taskname + taskname = @user1\`: Awards EXP for multiple tasks to the tagged player(s).
\`taskname xN = @user1\`: Awards EXP with a multiplier for multiple runs to the tagged player(s).
`
            }
        )
        .setTimestamp()
        .setFooter({ text: 'Raid Helper Bot | Your ultimate raid companion!' });
}

export function getHowToUseEmbed(raidHelperRoleName) {
    return new EmbedBuilder()
        .setTitle('📜 How to Use the Raid Helper Bot')
        .setDescription(
            `**1. Get Help Role:** Press the \`📣 Get Help Role\` button to receive the ${raidHelperRoleName} role and **get notified and have access to raid content**.\n\n` +
            `**2. Request a Raid:** Use the \`⚔️ Start Raid\` button and fill out the form. Use \`📋 Raid Tasks\` to see accepted tasks and their EXP values. ` +
            `For tasks not on the list, you can use generic tasks:\n` +
            ` • \`simple\`: Raids expected to take less than 5 to 10 minutes.\n` +
            ` • \`moderate\`: Raids expected to take less than 30 minutes.\n` +
            ` • \`hard\`: Raids expected to take 30 minutes or more.\n\n` +
                        `**3. Raid Coordination:** A dedicated thread will be created for your raid. Within this thread, you can use thread-only commands, update your raid's status or edit your request.\n\n` +            `**4. Complete Raid:** Click the \`🔒 Close Raid\` button in your thread. You will be prompted with instructions on how to tag helpers and finalize the raid.\n\n` +
            `**5. Leaderboard Points:** Check your points and rank using \`!leaderboard\` or \`!lb\` in the <#${LEADERBOARD_CHANNEL_ID}> channel. A maximum of \`${MAX_XP_PER_RAID} EXP\` can be earned per raid.\n\n` +
            `**Press the buttons below to interact with the bot and get more details:**`
        )
        .setColor(0x3498DB);
}

export function getCombinedTasksAndPointsEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x3498DB) // Blue
        .setTitle('📋 Raid Tasks & EXP Values')
        .setDescription(
            'You can use the following names for combined multiple tasks: `dailies`, `weeklies`, `templeshrine`, `originul`\n\n' +
            'Here\'s a comprehensive list of all recognized raid tasks and the EXP awarded for completing them. Use these when requesting raids or calculating points!'
        )
        .setTimestamp()
        .setFooter({ text: 'Raid Helper Bot | Tasks & Points' });

    // Helper to add fields dynamically based on column data
    const addThreeColumnFields = (name, col1, col2, col3) => {
        embed.addFields(
            { name: name, value: formatTasksForEmbed(col1, POINTS_CONFIG), inline: true }
        );
        if (col2.length > 0) {
            embed.addFields(
                { name: '\u200B', value: formatTasksForEmbed(col2, POINTS_CONFIG), inline: true }
            );
        }
        if (col3.length > 0) {
            embed.addFields(
                { name: '\u200B', value: formatTasksForEmbed(col3, POINTS_CONFIG), inline: true }
            );
        }
    };

    // --- Daily Raids (3 columns) ---
    const dailiesPerColumn = Math.ceil(DAILIES_LIST.length / 3);
    const dailiesCol1 = DAILIES_LIST.slice(0, dailiesPerColumn);
    const dailiesCol2 = DAILIES_LIST.slice(dailiesPerColumn, dailiesPerColumn * 2);
    const dailiesCol3 = DAILIES_LIST.slice(dailiesPerColumn * 2);
    addThreeColumnFields('☀️ `Daily` or `Dailies`', dailiesCol1, dailiesCol2, dailiesCol3);

    // --- blank space for 3rd column ---
    if (dailiesCol3.length === 0) {
        embed.addFields(
            { name: '\u200B', value: '\u200B', inline: true } // Empty field to maintain structure
        );
    }

    // --- Weekly Raids (3 columns) ---
    const weekliesPerColumn = Math.ceil(WEEKLIES_LIST.length / 3);
    const weekliesCol1 = WEEKLIES_LIST.slice(0, weekliesPerColumn);
    const weekliesCol2 = WEEKLIES_LIST.slice(weekliesPerColumn, weekliesPerColumn * 2);
    const weekliesCol3 = WEEKLIES_LIST.slice(weekliesPerColumn * 2);
    addThreeColumnFields('🗓️ `Weekly` or `Weeklies`', weekliesCol1, weekliesCol2, weekliesCol3);

    // --- Temple Shrine (3 columns) ---
    const tsPerColumn = Math.ceil(TEMPLESHRINE_LIST.length / 3);
    const tsCol1 = TEMPLESHRINE_LIST.slice(0, tsPerColumn);
    const tsCol2 = TEMPLESHRINE_LIST.slice(tsPerColumn, tsPerColumn * 2);
    const tsCol3 = TEMPLESHRINE_LIST.slice(tsPerColumn * 2);
    addThreeColumnFields('⛩️ `Templeshrine`', tsCol1, tsCol2, tsCol3);

    // --- Originul Raids (3 Columns) ---
    const originulPerColumn = Math.ceil(ORIGINUL_LIST.length / 3);
    const oRCol1 = ORIGINUL_LIST.slice(0, originulPerColumn);
    const oRCol2 = ORIGINUL_LIST.slice(originulPerColumn, originulPerColumn * 2);
    const oRCol3 = ORIGINUL_LIST.slice(originulPerColumn * 2); 
    addThreeColumnFields('🌌 `Originul` Raids', oRCol1, oRCol2, oRCol3);

    // --- Other Raids (3 column) ---
    const othersPerColumn = Math.ceil(OTHERS_LIST.length / 3);
    const othersCol1 = OTHERS_LIST.slice(0, othersPerColumn);
    const othersCol2 = OTHERS_LIST.slice(othersPerColumn, othersPerColumn * 2);
    const othersCol3 = OTHERS_LIST.slice(othersPerColumn * 2); 
    addThreeColumnFields('🗺️ Other Tasks', othersCol1, othersCol2, othersCol3);

    // --- Generic Tasks (single field) ---
    embed.addFields(
        { name: '💡 Generic Tasks', value: formatTasksForEmbed(GENERIC_TASKS_LIST, POINTS_CONFIG), inline: false }
    );

    return embed;
}

export function getInitialButtonsRow() {
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
        .setLabel('📋 Raid Tasks')
        .setStyle(ButtonStyle.Secondary);

    const showAllCommandsButton = new ButtonBuilder()
        .setCustomId('showAllCommands_btn')
        .setLabel('📝 Commands List')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder()
        .addComponents(startRaidButton, getHelpRoleButton, seeRaidTasksButton, showAllCommandsButton);
}


/**
 * Sets up the handler for general bot commands and interactions,
 * including the !raidinfo list, custom GIF triggers, and the "Get Help Role" button.
 * @param {Client} client The Discord client instance.
 */
export function setupGeneralCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const commandContent = message.content.toLowerCase();
        const userId = message.author.id;
        const now = Date.now();
        const lastUsed = gifCooldowns.get(userId);

        // Helper function to delete a cooldown warning message
        const deleteCooldownWarning = async (idToDelete) => {
            const messageToDelete = cooldownWarningMessages.get(idToDelete);
            if (messageToDelete) {
                try {
                    await messageToDelete.delete();
                } catch (err) {
                    // Ignore "Unknown Message" error (10008) if it was already deleted
                    if (err.code !== 10008) {
                        console.error(`Error deleting cooldown warning message for user ${idToDelete}:`, err);
                    }
                } finally {
                    cooldownWarningMessages.delete(idToDelete);
                }
            }
        };


        // --- Handle the !raidinfo command (formerly !raidcommands) ---
        if (commandContent === '!raidinfo' && message.channel.id === RAID_CHANNEL_ID) {
            let raidHelperRoleName = 'Raid Helper'; // Default name
            if (message.guild) {
                try {
                    const role = await message.guild.roles.fetch(RAID_HELPER_ROLE_ID);
                    if (role) {
                        raidHelperRoleName = role.name;
                    }
                } catch (error) {
                    console.error('Error fetching RAID_HELPER_ROLE_ID name for !raidinfo:', error);
                }
            }

            const howToUseEmbed = getHowToUseEmbed(raidHelperRoleName);
            const initialButtonsRow = getInitialButtonsRow();

            try {
                await message.channel.send({ embeds: [howToUseEmbed], components: [initialButtonsRow] });
            } catch (error) {
                console.error('Error sending !raidinfo embed:', error);
                await message.channel.send('Failed to display raid information. Please try again later.');
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
        // Check for regular gif commands (with embeds)
        if (gifCommands[commandContent]) {
            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

                // Delete any existing warning message before sending a new one
                await deleteCooldownWarning(userId);

                const warningMessage = await message.reply({ content: cooldownMessageContent });
                cooldownWarningMessages.set(userId, warningMessage);

                // Set a timeout to delete the warning message when the cooldown expires
                setTimeout(async () => {
                    await deleteCooldownWarning(userId);
                }, GIF_COOLDOWN_DURATION);
                return; // Exit if still on cooldown
            }

            // If not on cooldown, proceed to send the GIF
            gifCooldowns.set(userId, now); // Set new cooldown
            await deleteCooldownWarning(userId); // Delete any lingering warning message

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
            // **New Banned User Check**
            const bannedUsers = BANNED_USERS_FOR_COMMANDS[commandContent];
            if (bannedUsers && bannedUsers.includes(userId)) {
                return; 
            }

            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

                // Delete any existing warning message before sending a new one
                await deleteCooldownWarning(userId);

                const warningMessage = await message.reply({ content: cooldownMessageContent });
                cooldownWarningMessages.set(userId, warningMessage);

                // Set a timeout to delete the warning message when the cooldown expires
                setTimeout(async () => {
                    await deleteCooldownWarning(userId);
                }, GIF_COOLDOWN_DURATION);
                return; // Exit if still on cooldown
            }

            // If not on cooldown, proceed to send the GIF
            gifCooldowns.set(userId, now); // Set new cooldown
            await deleteCooldownWarning(userId); // Delete any lingering warning message

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
                /* re-add check once raid helper role is implemented 
                // check if they are a raid helper
                if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                    await interaction.reply({
                        content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Please click the '📣 Get Help Role' button first to obtain it.`,
                        ephemeral: true
                    });
                    return; 
                }
                */

                const raidModal = getRaidRequestModal();
                await interaction.showModal(raidModal);
                break;
            case 'seeRaidTasks_btn':
                // This button interaction now displays the combined tasks and points embed.
                const combinedTasksAndPointsEmbed = getCombinedTasksAndPointsEmbed();
                await interaction.reply({ embeds: [combinedTasksAndPointsEmbed], ephemeral: true });
                break;
            case 'showAllCommands_btn':
                const commandsEmbed = getCommandsEmbed();
                await interaction.reply({ embeds: [commandsEmbed], ephemeral: true });
                break;
            default:
                console.log(`Unhandled button interaction customId: ${interaction.customId}`);
                break;
        }
    });
}