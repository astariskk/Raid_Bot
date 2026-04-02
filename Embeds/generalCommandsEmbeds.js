import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import {
    EMBED_COLOR,
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
        .setColor(EMBED_COLOR)
        .setTitle('Commands')
        .setDescription('Here are the commands you can use with the Raid Helper Bot:')
        .addFields(
            {
                name: 'General',
                value:
                    `• \`!raidtasks\` — lists raid tasks by category\n` +
                    `• \`/raidtasks\` — slash version of raid tasks\n` +                    
                    `• \`!calculatetask <task1> + <task2>...\` — calculate EXP for tasks\n` +
                    `• \`/calculatetask\` — slash version of task calculation`,
                inline: false,
            },
            {
                name: 'Inside Raid Tickets',
                value:
                    `• \`!waiting\` / \`!ongoing\` / \`!full\` — update raid status (requester/staff)\n` +
                    `• \`!raidmaps <number>\` or \`!maps <number>\` — show join maps for this ticket\n` +
                    `• \`!charts\` — show available charts\n` +
                    `• \`!1man\` \`!2man\` \`!3man\` \`!4man\` — ultraspeaker charts\n` +
                    `• \`!lpchart\` \`!gramielchart\` \`!gramiel\` — additional charts`,
                inline: false,
            },
        )
        .setTimestamp()
        .setFooter({ text: 'Raid Helper Bot | Commands' });
}

export function getHowToUseEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('How to Use the Raid Helper Bot')
        .addFields(
            {
                name: '1) Get Help Role',
                value: `Press \`Get Help Role\` to toggle the <@&${RAID_HELPER_ROLE_ID}> role.`,
                inline: false,
            },
            {
                name: '2) Start Raid',
                value:
                    'Press `Start Raid`, pick categories + tasks, then fill in the details modal.\n' +
                    'If your task is not listed, use other tasks: '+ 
                    '`simple` - for 7 man rooms and tasks that will take less than 5 minutes' +
                    '`moderate` - for tasks that will take 5-20 minutes' +
                    '`difficult` - for 1% drop chance farms and tasks that will take more than 60 minutes',
                inline: false,
            },
            {
                name: '3) During the Raid',
                value: 'In the ticket you can type `!waiting`, `!ongoing`, or `!full`.',
                inline: false,
            },
            {
                name: '4) Closing & Points',
                value:
                    'Press `Close Raid`, select helpers, and (optional) use `Partial Helper` to assign helpers to specific tasks for partial EXP.\n' +
                    `Max \`${MAX_XP_PER_RAID} EXP\` per player per raid.`,
                inline: false,
            },
            {
                name: '5) Leaderboard',
                value: `Use \`!leaderboard\` / \`!lb\` in <#${LEADERBOARD_CHANNEL_ID}>.`,
                inline: false,
            },
        );
}

export function getRaidRulesEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Raid Rules')
        .addFields(
            { name: '1) One Request At A Time', value: 'Only 1 request may be active per requester.', inline: false },
            { name: '2) No Proxy Requests', value: 'You cannot request a raid for another person.', inline: false },
            {
                name: '3) No Abuse / Spam',
                value:
                    `Do not spam or excessively ping <@&${RAID_HELPER_ROLE_ID}>, <@&${OFFICER_ROLE_ID}>, or <@&${MODERATOR_ROLE_ID}>.\n` +
                    'Excessive spam or repeated tickets may result in a ban.',
                inline: false,
            },
            {
                name: '4) Re-ping Rule',
                value: `If no one comes after 30 minutes, you may re-ping <@&${RAID_HELPER_ROLE_ID}> **once**. If still no one comes, close the ticket and try later.`,
                inline: false,
            },
            { name: '5) Alts', value: 'Alts can help, but the requester may ask for an alt to be removed if needed.', inline: false },
            {
                name: '6) Staff Discretion',
                value: `All <@&${MODERATOR_ROLE_ID}> and <@&${OFFICER_ROLE_ID}> may issue warnings/bans for misuse or misconduct.`,
                inline: false,
            },
            { name: '7) Follow Ticket Flow', value: 'Open/close tickets using the buttons and follow instructions.', inline: false },
        );
}

export function getCombinedTasksAndPointsEmbed() {
    const embeds = [];

    const addThreeColumnFields = (embed, name, list) => {
        const perColumn = Math.ceil(list.length / 3);
        const col1 = list.slice(0, perColumn);
        const col2 = list.slice(perColumn, perColumn * 2);
        const col3 = list.slice(perColumn * 2);

        embed.addFields(
            { name, value: formatTasksForEmbed(col1, POINTS_CONFIG), inline: true },
            { name: '\u200B', value: col2.length ? formatTasksForEmbed(col2, POINTS_CONFIG) : '\u200B', inline: true },
            { name: '\u200B', value: col3.length ? formatTasksForEmbed(col3, POINTS_CONFIG) : '\u200B', inline: true },
        );
    };

    // -----------------------------------------------------------
    // EMBED 1 — 4-MAN TASKS
    // -----------------------------------------------------------
    const embed4Man = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('4-Man Tasks')
        .setDescription('Use these task keys in `Start Raid` or in calculations.');

    addThreeColumnFields(embed4Man, '`Daily` / `Dailies`', DAILIES_LIST);
    addThreeColumnFields(embed4Man, ' Other 4-Man Tasks', OTHERS_FOUR_LIST);
    addThreeColumnFields(embed4Man, '`Weekly` / `Weeklies`', WEEKLIES_LIST);
    addThreeColumnFields(embed4Man, '`Templeshrine` / `Tshrine`', TEMPLESHRINE_LIST);

    embeds.push(embed4Man);

    // -----------------------------------------------------------
    // EMBED 2 — 7-MAN TASKS
    // -----------------------------------------------------------
    const embed7Man = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('7-Man Tasks')
        .setDescription('Use these task keys in `Start Raid` or in calculations.');

    addThreeColumnFields(embed7Man, '`Originul` Raids', ORIGINUL_LIST);
    addThreeColumnFields(embed7Man, '`Legion` Daily Tasks', LEGION_LIST);
    addThreeColumnFields(embed7Man, '`Other 7-Man Tasks`', OTHERS_SEVEN_LIST);

    embeds.push(embed7Man);

    // -----------------------------------------------------------
    // EMBED 3 — GENERIC TASKS
    // -----------------------------------------------------------
    const embedGeneric = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Other Tasks')
        .setDescription('Use these when your task is not in the list.')
        .addFields({
            name: '\u200B',
            value: formatTasksForEmbed(GENERIC_TASKS_LIST, POINTS_CONFIG),
            inline: false
        });

    embeds.push(embedGeneric);

    return embeds;
}

export function getInitialButtonsRow() {
    const startRaidButton = new ButtonBuilder()
        .setCustomId('startRaidWizard_btn')
        .setLabel('⚔️ Start Raid')
        .setStyle(ButtonStyle.Primary);

    const getHelpRoleButton = new ButtonBuilder()
        .setCustomId('getHelpRole_btn')
        .setLabel('📣 Get Help Role')
        .setStyle(ButtonStyle.Secondary);

    const seeRaidTasksButton = new ButtonBuilder()
        .setCustomId('seeRaidTasks_btn')
        .setLabel('📙 Raid Tasks')
        .setStyle(ButtonStyle.Secondary);

    const showAllCommandsButton = new ButtonBuilder()
        .setCustomId('showAllCommands_btn')
        .setLabel('📙 Commands List')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder()
        .addComponents(startRaidButton, getHelpRoleButton, seeRaidTasksButton, showAllCommandsButton);
}

// Legacy: kept for backwards compatibility (old !raidinfo flow).
export function getStringSelectMenu() {
    const raidTypeSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('raidTypeSelect')
        .setPlaceholder('Select Room Type')
        .addOptions([
            { label: '4-man rooms', value: '4-man', description: 'Dailies, Weeklies, Speaker, Tyndarius, any 4-man rooms' },
            { label: '7-man rooms', value: '7-man', description: 'Mechabinky, kathool, Astralshrine, any 7-man rooms' },
            { label: 'Other rooms', value: 'other', description: `Select this If you're unsure about room size` },
        ]);

    return new ActionRowBuilder().addComponents(raidTypeSelectMenu);
}

export function getChartsEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Available Charts')
        .setDescription(null)
        .addFields(
            { name: 'Ultraspeaker Taunt Charts', value: '`!1man`, `!2man`, `!3man`, `!4man`, `!lpchart`, `!famischart`, `!scamcharts` or `!scams`' },
            { name: 'Ultragramiel Chart', value: '`!gramielchart` or `!gramiel`' },
        )
        .setTimestamp()
        .setFooter({ text: 'Charts' });
}

export function getLeaderboardCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Leaderboard Commands List')
        .setDescription('Shown using `!lbcommands`. Commands to check raid experience and rankings:')
        .addFields(
            {
                name: 'Leaderboard',
                value: `
\`!leaderboard\` / \`!lb\` - show the leaderboard (paginated)
\`/lb\` - slash version of leaderboard / EXP check
`
            },
            {
                name: 'EXP Check (1-3 days max)',
                value: `
\`!lbcheck [@user...] [today|yesterday|YYYY-MM-DD|from <start> to <end>]\`
\`/lb range:<input> users:<mentions>\` or \`/lb from:<YYYY-MM-DD> to:<YYYY-MM-DD>\`
**Example:** \`!lbcheck @user1 @user2 from 2026-04-01 to 2026-04-02\`
`,
            }
        )
        .setTimestamp()
        .setFooter({ text: 'Raid Helper Bot | Leaderboard Commands' });
}

export function getModeratorCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Moderator Commands List')
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
\`!restorelb\`: Restore leaderboard totals from a JSON backup (staff only). Then upload the JSON file as your next message.

**GIF/Text command**
\`!addgif <triggerword>\` / \`/addgif\`: create a new GIF/Text command
\`!editgif <triggerword>\` / \`/editgif\`: edit an existing GIF/Text command
Then use the buttons on the preview message: \`Edit\`, \`Change Image\`, \`Delete\`, \`Save and Close\`.

**Charts**
\`!editchart\` or \`/editchart\`: create/edit multi-page chart images
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
        .setColor(EMBED_COLOR)
        .setTitle('Secret Gif Commands List ')
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
    const embed = new EmbedBuilder()
        .setColor(gifInfo.color ?? EMBED_COLOR);

    const title = String(gifInfo.title ?? '').trim();
    if (title) embed.setTitle(title);

    const image = String(gifInfo.image ?? '').trim();
    if (image) embed.setImage(image);

    const footer = String(gifInfo.footer ?? '').trim();
    if (footer) embed.setFooter({ text: footer });

    return embed;
}

