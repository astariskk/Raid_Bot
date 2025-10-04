// handlers/generalCommandsHandler.js
import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    RAID_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RECORD_HOLDER_ROLE_ID,
    LEADERBOARD_CHANNEL_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
    MAX_XP_PER_RAID,
    POINTS_CONFIG,
    TASK_MAP_CATEGORIES,
    DAILIES_LIST,
    WEEKLIES_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    OTHERS_FOUR_LIST,
    OTHERS_SEVEN_LIST,
    GENERIC_TASKS_LIST,
    TASK_ALIASES,
} from '../config/constants.js';
import { getRaidRequestModal } from './raidTicketHandler.js';
import { calculateTaskPointsWithMultiplier } from '../utils/taskCalculations.js'; // Import the new helper

// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
const cooldownWarningMessages = new Map();
const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- User IDs to ban from specific commands ---
const BANNED_USERS_FOR_COMMANDS = {
     // Kuro 719443918621638660 banned from 'marbike'
};

// --- Custom GIF Commands (for embeds) ---
export const gifCommands = {

    // 50/50 of getting one of the gifs
    "shaboingboing": [
        {
            title: "You gotta give him that Hawk Tuah",
            image: 'https://files.catbox.moe/qy74ka.gif',
            footer: 'Gawk gawk gawk',
            color: 0xaa8f7d
        },
        {
            title: "wait, there's another HAWK TUAH!?",
            image: 'https://files.catbox.moe/21jx2k.gif',
            footer: 'The throat goat',
            color: 0xaa8f7d
        }
    ],
};

// --- Custom TEXT GIF Commands (no embeds) ---
export const textGifCommands = {
    // --- other tags ---
    'acefault': '<@467703633618796544> [**ALWAYS AT FAURLT**](https://files.catbox.moe/chroap.gif)',                            // Ace 467703633618796544
    'kaerat': "<@792031861425569822> [**IT'S THE RAT**](https://files.catbox.moe/1leclp.gif)",                                  // kae 792031861425569822
    'sybauwordles' :'<@252026199667245056> [**Bark for me like you mean it**](https://tenor.com/view/rage-rage-bait-baited-rage-baited-angry-dog-gif-2047466162835898859)',  // wordle 252026199667245056
    'ninjaboing' : '<@502473085857824779> [**I LIKE TO MOVE IT MOVE IT**](https://files.catbox.moe/6lusbi.gif)',                   // ninja 502473085857824779

    // --- xy --- 965985831649169438
    'xyfart': '<@965985831649169438> [**BABAGAN MENYANG**](https://files.catbox.moe/kyqp98.gif)',                                        

    // --- amarah --- 1030038861851664404
    'marbike': '<@1030038861851664404> [**RIDE TO THE HARAM LAND WHERE I BELONG**](https://files.catbox.moe/ayl6ui.gif)',       
    'marplane': '<@1030038861851664404> [**KABOOM BITCHESSS**](https://files.catbox.moe/owtx3d.gif)',                           

    // --- kuro --- 719443918621638660
    'kurobike': `<@719443918621638660> [**RIDING JINU'S DIHH**](https://imgur.com/a/wKpRDrw)`,                                                             
    'kurodance' : `<@719443918621638660> 🗣️ [**SHUT UP AND DANCE WITH ME**](https://files.catbox.moe/l80j6z.gif)`,                       

    // -- kui --- 713920796913041459
    'kuipunt': `<@713920796913041459> [**MISU BROKE MY HEART LIKE THIS**](https://files.catbox.moe/zhlcsh.gif)`,                
    'kuimilk' : '<@713920796913041459> [**I LOVE THIS THICK WHITE STUFF DRINK**](https://files.catbox.moe/gkvm27.gif)',         
    'kuirage' : '<@713920796913041459> [**YOU CANT FINGER ME LIKE THAT**](https://files.catbox.moe/hqqolp.gif)',                

    // --- famis --- 365314970633633793
    'famisgoon' : `<@365314970633633793> [**LET ME GOON**](https://files.catbox.moe/xrf4y6.gif)`,                               
    'fapmisgoon' : `<@365314970633633793> [**IM GONNA GOON TILL I PASS OUT**](https://files.catbox.moe/bffw6o.gif)`,
    'goonmis' : '<@365314970633633793> [**SHE CAN SUCK MORE THAN JUST MY BLOOD**](https://files.catbox.moe/3o3stq.gif)', 
    'famridaa' : '<@365314970633633793> [**GOON RIDAAA**](https://files.catbox.moe/ae1svi.gif)',          

    // --- keiji --- 227002059784716288
    'keijiwave' : '<@227002059784716288> [**The boy from up!**](https://files.catbox.moe/661usf.gif)',                          
    'keijifart' : '<@227002059784716288> 🗣️🗣️ [**I FART SO HARD, AND GOT SO FAR**](https://files.catbox.moe/99wg0n.gif)',         
    'keijidance' : `<@227002059784716288> [**IM 'BOUT TO GET UP ON THAT AHH RIGHT NYEOW**](https://files.catbox.moe/1gitfq.gif)`,

    // --- pix --- 192921939818315777
    'pixpunt' :'<@192921939818315777> [**SYBAU PIX**](https://files.catbox.moe/rvy8fy.gif)',                 
    
    // --- royalty --- 201893726535024640
    'royaltyswag' : `<@201893726535024640> [**SWIGGITY SWOOTY IM COMIN' FO DAT BOOTY**](https://files.catbox.moe/4q6j3m.gif)`,

    // --- others ---                                                                  
    'ungyatt': 'UN QUE? [**UN GYATT**](https://imgur.com/a/VT1KU6I)',
 
}

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
        .setDescription('Here are the commands you can use with the Raid Helper Bot:')
        .addFields(
            {
                name: '📊 General Raid & Status Commands',
                value: `
\`!raidtasks\`: Lists all available raid tasks **by category**.
\`!calculatetask <task1> [xN] + <task2> [xN] + ...\`: Calculates total points for specified tasks.\n
`
            },
            {
                name: '⚔️ Commands Inside Raid Tickets',
                value: `
\`!raidmaps [number]\`: Displays the map's specified in the raid to make joining maps easier.
\`!raidsite\`: Sends a website for making joining maps easier.
\`!waiting\`: Set the raid status to 'Waiting (requester only)'.
\`!ongoing\`: Set the raid status to 'Ongoing (requester only)'.
\`!full\`: Set the raid status to 'Full (requester only)'.
\`!1man\`: Displays the 1-man taunt chart for ultraspeaker.
\`!2man\`: Displays the 2-man taunt chart for ultraspeaker.
\`!3man\`: Displays the 3-man taunt chart for ultraspeaker.
\`!4man\`: Displays the 4-man taunt chart for ultraspeaker.
\`!lpchart\`: Displays the chart for
\`!gramielchart\` or \`!gramiel\`: Displays the chart for ultragramiel.
`
            },
            {
                name: '💬 Commands for closing the Raid Request',
                value: `
\`cancel\`: Close the raid ticket without awarding points.
\`+\` and \`,\`: Use these to separate multiple tasks.
\`=\` \`-\` and \`:\` : Use these to separate tasks and tag helpers.
\`all = @user1 @user2\`: Awards EXP for all tasks requested in the raid to the tagged player(s).
\`taskname = @user1 @user2\`: Awards EXP for a specific task to tagged player(s).
\`taskname + taskname = @user1\`: Awards EXP for multiple tasks to the tagged player(s).
\`taskname xN = @user1\`: Awards EXP with a multiplier for multiple runs to the tagged player(s).
`
            }
        )
        .setTimestamp()
        .setFooter({ text: 'Bot Commands' });
}

export function getHowToUseEmbed(raidHelperRoleName) {
    return new EmbedBuilder()
        .setTitle('📜 How to Use the Raid Helper Bot')
        .setDescription(
            `**1. Get Help Role:** Press the \`📣 Get Help Role\` button to receive the ${raidHelperRoleName} role and **get notified and have access to raid content**. You can press it again to remove the role\n\n` +
            `**2. Request a Raid:** Use the \`⚔️ Start Raid\` button and fill out the form. Use \`📋 Raid Tasks\` to see accepted tasks and their EXP values. ` +
            `For tasks not on the list, you can use generic tasks:\n` +
            ` • \`simple\`: Raids expected to take less than 5 to 10 minutes and 7 man rooms.\n` +
            ` • \`moderate\`: Raids expected to take less than 30 minutes.\n` +
            ` • \`hard\`: Raids expected to take 30 minutes or more which includes 1% drop chance farms and learning ultra boss mechanics .\n\n` +
            `**3. Raid Coordination:** A dedicated ticket will be created for your raid. Within this ticket, you can use ticket-only commands, update your raid's status or edit your request.\n\n` +
            `**4. Complete Raid:** Click the \`🔒 Close Raid\` button in your ticket. You will be prompted with instructions on how to tag helpers and finalize the raid.\n\n` +
            `**5. Leaderboard Points:** Check your points and rank using \`!leaderboard\` or \`!lb\` in the <#${LEADERBOARD_CHANNEL_ID}> channel. A maximum of \`${MAX_XP_PER_RAID} EXP\` can be earned per raid.\n All <@&${RECORD_HOLDER_ROLE_ID}> will automatically receive \`10000\` points every month as long as their record is not broken.\n\n` +
            `**Press the buttons below to interact with the bot and get more details:**`
        )
        .setColor(0x3498DB);
}

export function getRaidRulesEmbed() {
    return new EmbedBuilder()
        .setTitle('📜 Raid Rules')
        .setDescription(
            `**Welcome to Vanaheim's Raid Channel** \n\n` +
            'Rules for using the channel. \n' +
            '1. Only 1 request to be made at a time. \n' +
            '2. You cannot make a request for another person.\n' +
            `3. Serious abuse of the channel - excessive pinging of <@&${RAID_HELPER_ROLE_ID}>, <@&${OFFICER_ROLE_ID}> and <@&${MODERATOR_ROLE_ID}> and multiple tickets made within an hour can result in an indefinite ban from the use of the raid assistance channel. \n` +
            `4. If no one comes to the raid after 30 minutes - you can re-ping <@&${RAID_HELPER_ROLE_ID}> once. If no one still comes, close the ticket and try again later. \n` +
            '5. Alts can be used to help with raids, but the raid requester can request the alt to be removed from the raid if they want. \n' +
            `6. All <@&${MODERATOR_ROLE_ID}> and <@&${OFFICER_ROLE_ID}> have the right to issue warnings and bans as they see fit base on misuse and player misconduct during raids. \n` +
            '7. Follow the instructions below for opening and closing the ticket - improper way of doing so can result of a warning which may eventually lead to a ban. \n'
        )
        .setColor(0x3498DB);
}

export function getCombinedTasksAndPointsEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x3498DB) // Blue
        .setTitle('📋 Raid Tasks & EXP Values')
        .setDescription(
            'You can use the following names for combined multiple tasks: `dailies` or `daily`, `weeklies` or `weekly`, `templeshrine`, `originul`\n' +
            'below are the list of available tasks and exp values sectioned by their category.\n\n'
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

    // --- Other 4 Room Raids (3 column) ---
    const othersFourpercolumn = Math.ceil(OTHERS_FOUR_LIST.length / 3);
    const othersFourCol1 = OTHERS_FOUR_LIST.slice(0, othersFourpercolumn);
    const othersFourCol2 = OTHERS_FOUR_LIST.slice(othersFourpercolumn, othersFourpercolumn * 2);
    const othersFourCol3 = OTHERS_FOUR_LIST.slice(othersFourpercolumn * 2);
    addThreeColumnFields('🗺️ Other 4 Room Tasks', othersFourCol1, othersFourCol2, othersFourCol3);

    // --- blank space for 3rd column ---
    if (dailiesCol3.length === 0) {
        embed.addFields(
            { name: '\u200B', value: '\u200B', inline: true } // Empty field to maintain structure
        );
    }

    // --- Other 7 Room Raids (3 column) ---
    const othersSevenperColumn = Math.ceil(OTHERS_SEVEN_LIST.length / 3);
    const othersSevenCol1 = OTHERS_SEVEN_LIST.slice(0, othersSevenperColumn);
    const othersSevenCol2 = OTHERS_SEVEN_LIST.slice(othersSevenperColumn, othersSevenperColumn * 2);
    const othersSevenCol3 = OTHERS_SEVEN_LIST.slice(othersSevenperColumn * 2);
    addThreeColumnFields('🗺️ Other 7 Room Tasks', othersSevenCol1, othersSevenCol2, othersSevenCol3);

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
            let raidHelperRoleName = 'Raid Helper'; 
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

        // --- Handle the !RaidRules command ---
        if (commandContent === '!raidrules' && message.channel.id === RAID_CHANNEL_ID) {
            const raidRulesEmbed = getRaidRulesEmbed();
            try {
                await message.channel.send({ embeds: [raidRulesEmbed] });
            } catch (error) {
                console.error('Error sending !raidrules embed:', error);
                await message.channel.send('Failed to display raid rules. Please try again later.');
            }
            return; 
        }

        // --- Handle the !calculatetask command ---
        if (commandContent.startsWith('!calculatetask')) {
            const args = message.content.slice('!calculatetask'.length).trim();

            const {
                totalCalculatedPoints,
                originalTotalCalculatedPoints,
                unknownTasks
            } = calculateTaskPointsWithMultiplier(args);

            let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP\n\n`;


            if (unknownTasks.length > 0) {
                replyContent += `\n\n_Note: The following tasks were not recognized and were not included in the calculation: ${unknownTasks.join(', ')}._`;
            }
            
            if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
                replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP (original total: ${originalTotalCalculatedPoints} EXP)._`;
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
                .setColor(0x3498DB) 
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

            for (const cmd in gifCommands) {
                secretGifCommandsList += `* \`${cmd}\`\n`;
            }
            // Add commands from textGifCommands (no embeds)
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
            try {
                await message.channel.send({ embeds: [secretCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !secretcommands embed:', error);
                await message.channel.send('Failed to display secret Gif commands. Please try again later.');
            }
        }

        // --- Consolidated Custom GIF Commands Handling ---
        if (gifCommands[commandContent]) {
            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

                await deleteCooldownWarning(userId);

                const warningMessage = await message.reply({ content: cooldownMessageContent });
                cooldownWarningMessages.set(userId, warningMessage);

                // Set a timeout to delete the warning message when the cooldown expires
                setTimeout(async () => {
                    await deleteCooldownWarning(userId);
                }, GIF_COOLDOWN_DURATION);
                return; 
            }

            // If not on cooldown, proceed to send the GIF
            gifCooldowns.set(userId, now);
            await deleteCooldownWarning(userId);

            let gifInfo = gifCommands[commandContent];
            // Check if the value is an array, if so, pick a random entry
            if (Array.isArray(gifInfo)) {
                const randomIndex = Math.floor(Math.random() * gifInfo.length);
                gifInfo = gifInfo[randomIndex];
            }

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
            // Banned User Check
            const bannedUsers = BANNED_USERS_FOR_COMMANDS[commandContent];
            if (bannedUsers && bannedUsers.includes(userId)) {
                return;
            }

            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

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
            gifCooldowns.set(userId, now);
            await deleteCooldownWarning(userId);

            const messageToSend = textGifCommands[commandContent];

            try {
                await message.channel.send(messageToSend);
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
                const guild = interaction.guild;
                const member = interaction.member;

                if (!guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
                    return;
                }

                try {
                    const role = await guild.roles.fetch(RAID_HELPER_ROLE_ID);

                    // Debugging Purposes
                    if (!role) {
                        await interaction.reply({ content: 'The specified helper role was not found. Please contact an an administrator.', ephemeral: true });
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

                    // Role assignment logic
                    if (member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                        await member.roles.remove(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setDescription(`The <@&${RAID_HELPER_ROLE_ID}> role has been removed.`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setDescription(`The <@&${RAID_HELPER_ROLE_ID}> role has been added!`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }

                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', ephemeral: true });
                }
                break;
            case 'startRaid_btn':
                // check if they are a raid helper
                if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                    await interaction.reply({
                        content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Please click the '📣 Get Help Role' button first to obtain it.`,
                        ephemeral: true
                    });
                    return;
                }

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
