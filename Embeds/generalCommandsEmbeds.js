import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
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
    LEGION_LIST,
} from '../config/constants.js';
import { threadActionRow } from '../Embeds/raidTicketEmbeds.js';

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
\`!raidmaps [number]\` or \`!maps\`: Displays the map's specified in the raid to make joining maps easier.
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
        )
        .setTimestamp()
        .setFooter({ text: 'Bot Commands' });
}

export function getHowToUseEmbed() {
    return new EmbedBuilder()
        .setTitle('📜 How to Use the Raid Helper Bot')
        .setDescription(
            `**1. Get Help Role:** Get the <@&${RAID_HELPER_ROLE_ID}> Role using the \`📣 Get Help Role\` button to have access to raid content**. You can press it again to remove the role\n\n` +
            `**2. **Request a Raid:** Select the room based on room size, and type out the task listed in the \`Raid task\` button ` +
            `For tasks not on the list, you can use generic tasks:\n` +
            ` • \`simple\`: Raids expected to take less than 5 to 10 minutes and 7 man rooms.\n` +
            ` • \`moderate\`: Raids expected to take less than 30 minutes.\n` +
            ` • \`hard\`: Raids expected to take 30 minutes or more which includes 1% drop chance farms and learning ultra boss mechanics .\n\n` +
            `**3. Raid Coordination:** A dedicated ticket will be created for your raid. Within this ticket, you can use ticket-only commands, update your raid's status or edit your request.\n\n` +
            `**4. Complete Raid:** Click the \`🔒 Close Raid\` button in your ticket. Simply Mention the Helpers to close.\n\n` +
            `**5. Leaderboard Points:** Check your points and rank using \`!leaderboard\` or \`!lb\` in the <#${LEADERBOARD_CHANNEL_ID}> channel. A maximum of \`${MAX_XP_PER_RAID} EXP\` can be earned per raid.\n All <@&${RECORD_HOLDER_ROLE_ID}> will receive \`10000\` points for every reacord each month as long as their record is not broken.\n\n` +
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

    function getTasksDescriptionEmbed() {
        return new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle("Raid Tasks & EXP Values")
            .setDescription(
                "You can use the following combined task names: `dailies`, `daily`, `weeklies`, `weekly`, `templeshrine`, `originul`, `legion`.\n" +
                "You can also view alternative task names using `/taskalias [task]`.\n\n" +
                "Below are the complete lists of available tasks and EXP values, divided into categories."
            )
            .setTimestamp()
            .setFooter({ text: "Raid Helper Bot | Tasks & Points" });
    }

    function addThreeColumnFields(embed, title, list) {
        const colSize = Math.ceil(list.length / 3);

        const col1 = list.slice(0, colSize);
        const col2 = list.slice(colSize, colSize * 2);
        const col3 = list.slice(colSize * 2);

        embed.addFields({ name: title, value: formatTasksForEmbed(col1, POINTS_CONFIG), inline: true });
        embed.addFields({
            name: "\u200B",
            value: col2.length ? formatTasksForEmbed(col2, POINTS_CONFIG) : "\u200B",
            inline: true
        });
        embed.addFields({
            name: "\u200B",
            value: col3.length ? formatTasksForEmbed(col3, POINTS_CONFIG) : "\u200B",
            inline: true
        });
    }

    function getFourManTasksEmbed() {
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle("4-Man Tasks");

        addThreeColumnFields(embed, "Daily Tasks", DAILIES_LIST);
        addThreeColumnFields(embed, "Weekly Tasks", WEEKLIES_LIST);
        addThreeColumnFields(embed, "Temple Shrine Tasks", TEMPLESHRINE_LIST);
        addThreeColumnFields(embed, "Other 4-Man Tasks", OTHERS_FOUR_LIST);

        return embed;
    }

    function getSevenManTasksEmbed() {
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle("7-Man Tasks");

        addThreeColumnFields(embed, "Originul Tasks", ORIGINUL_LIST);
        addThreeColumnFields(embed, "Legion Tasks", LEGION_LIST);
        addThreeColumnFields(embed, "Other 7-Man Tasks", OTHERS_SEVEN_LIST);

        return embed;
    }

    function getGenericTasksEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("Generic Tasks")
        .setDescription(
            "These tasks are general-purpose and may apply to both 4-man and 7-man rooms.\n" +
            "Use these when your requested task does not clearly fit into the main categories."
        )
        .addFields({
            name: "Available Generic Tasks",
            value: formatTasksForEmbed(GENERIC_TASKS_LIST, POINTS_CONFIG),
            inline: false
        });
}

export function getCombinedTasksAndPointsEmbed() {
    const descriptionEmbed = getTasksDescriptionEmbed();
    const fourManEmbed = getFourManTasksEmbed();
    const sevenManEmbed = getSevenManTasksEmbed();
    const genericTasksEmbed = getGenericTasksEmbed();
    return [descriptionEmbed, fourManEmbed, sevenManEmbed, genericTasksEmbed];
}

export function getInitialButtonsRow() {
    const getHelpRoleButton = new ButtonBuilder()
        .setCustomId('getHelpRole_btn')
        .setLabel('📣 Get Help Role')
        .setStyle(ButtonStyle.Secondary);

    const seeRaidTasksButton = new ButtonBuilder()
        .setCustomId('seeRaidTasks_btn')
        .setLabel('📋 Raid Tasks')
        .setStyle(ButtonStyle.Secondary);

    const showAllCommandsButton = new ButtonBuilder()
        .setCustomId('showAllCommands_btn')
        .setLabel('📝 Commands List')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder()
        .addComponents(getHelpRoleButton, seeRaidTasksButton, showAllCommandsButton);
}

export function getStringSelectMenu() {
    // Create the string select menu
    const raidTypeSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('raidTypeSelect')
        .setPlaceholder('⚔️ Select Room Type')
        .addOptions([
            { label: '4-man rooms', value: '4-man', description: 'Dailies, Weeklies, Speaker, Tyndarius, any 4-man rooms' },
            { label: '7-man rooms', value: '7-man', description: 'Mechabinky, kathool, Astralshrine, any 7-man rooms' },
            { label: 'Other rooms', value: 'other', description: `Select this If you're unsure about room size`},
        ]);

    return new ActionRowBuilder().addComponents(raidTypeSelectMenu);
}

export function getChartsEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB) // blue
        .setTitle('📊 Available Charts')
        .setDescription(null)
        .addFields(
            { name: 'Ultraspeaker Taunt Charts', value: '`!1man`, `!2man`, `!3man`, `!4man`, `!lpchart`, `!famischart`',  },
            { name: 'Ultragramiel Chart', value: '`!gramielchart` or `!gramiel`' },
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
\`!addxp @user @user <amount>\`: Manually add EXP to user(s).
\`/addxp\`: slash command version
\`!removexp @user @user <amount>\`: Manually remove EXP to user(s).
\`/removexp\`: slash command version
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
