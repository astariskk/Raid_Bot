import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    RAID_HELPER_ROLE_ID,
    RECORD_HOLDER_ROLE_ID,
    LEADERBOARD_CHANNEL_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    MAX_XP_PER_RAID,
    POINTS_CONFIG,
    DAILIES_LIST,
    WEEKLIES_LIST,
    TEMPLESHRINE_LIST,
    ORIGINUL_LIST,
    OTHERS_FOUR_LIST,
    OTHERS_SEVEN_LIST,
    GENERIC_TASKS_LIST,
} from '../config/constants.js';

function formatTasksForEmbed(taskList, pointsConfig) {
    if (!taskList || taskList.length === 0) {
        return 'N/A';
    }
    return taskList.map(task => {
        const points = pointsConfig[task.toLowerCase()];
        return `\`${task}\`: ${points !== undefined ? `${points} EXP` : 'N/A'}`;
    }).join('\n');
}

export function getCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB) // blue
        .setDescription('Here are the commands you can use with the Raid Helper Bot:')
        .addFields(
            {
                name: '📊 General Raid & Status Commands',
                value: `
\`!raidtasks\`: Lists all available raid tasks **by category**.
\`!calculatetask <task1> [xN] + <task2> [xN] + ...\`: Calculates total points for specified tasks.
\`/taskalias <tasks>\`: Show aliases for one or more tasks. \n
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
\`!charts\`: Displays all available charts.
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
        // Add name field with content
        embed.addFields(
            { name: name, value: formatTasksForEmbed(col1, POINTS_CONFIG), inline: true }
        );
        // Add blank fields to maintain 3-column structure
        if (col2.length > 0) {
            embed.addFields(
                { name: '\u200B', value: formatTasksForEmbed(col2, POINTS_CONFIG), inline: true }
            );
        } else {
            embed.addFields({ name: '\u200B', value: '\u200B', inline: true }); // Empty field 2
        }

        if (col3.length > 0) {
            embed.addFields(
                { name: '\u200B', value: formatTasksForEmbed(col3, POINTS_CONFIG), inline: true }
            );
        } else {
            embed.addFields({ name: '\u200B', value: '\u200B', inline: true }); // Empty field 3
        }
    };

    // --- Daily Raids (3 columns) ---
    const dailiesPerColumn = Math.ceil(DAILIES_LIST.length / 3);
    const dailiesCol1 = DAILIES_LIST.slice(0, dailiesPerColumn);
    const dailiesCol2 = DAILIES_LIST.slice(dailiesPerColumn, dailiesPerColumn * 2);
    const dailiesCol3 = DAILIES_LIST.slice(dailiesPerColumn * 2);
    addThreeColumnFields('☀️ `Daily` or `Dailies`', dailiesCol1, dailiesCol2, dailiesCol3);

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

export function getChartsEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB) // blue
        .setTitle('📊 Available Charts')
        .setDescription(null)
        .addFields(
            { name: 'Ultraspeaker Taunt Charts', value: '`!1man`, `!2man`, `!3man`, `!4man`' },
            { name: 'Ultragramiel Chart', value: '`!gramielchart` or `!gramiel`' },
            { name: 'LP Chart', value: '`!lpchart`' }
        )
        .setTimestamp()
        .setFooter({ text: 'Charts' });
}

export function getLeaderboardCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB) // blue
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
}

export function getModeratorCommandsEmbed() {
    return new EmbedBuilder()
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
}

export function getSecretCommandsEmbed(gifCommands, textGifCommands) {
    let secretGifCommandsList = '';

    for (const cmd in gifCommands) {
        secretGifCommandsList += `* \`${cmd}\`\n`;
    }
    for (const cmd in textGifCommands) {
        secretGifCommandsList += `* \`${cmd}\`\n`;
    }

    return new EmbedBuilder()
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
}

export function createCustomGifEmbed(gifInfo) {
    return new EmbedBuilder()
        .setColor(gifInfo.color)
        .setTitle(gifInfo.title)
        .setImage(gifInfo.image)
        .setFooter({ text: gifInfo.footer });
}
