import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import {
  EMBED_COLOR,
  RAID_HELPER_ROLE_ID,
  LEADERBOARD_CHANNEL_ID,
  MODERATOR_ROLE_ID,
  OFFICER_ROLE_ID,
} from '../config/constants.js';

// Use local fallbacks when MAX_XP_PER_RAID is not exported in the trimmed repo.
const MAX_XP_PER_RAID_SAFE = typeof globalThis.MAX_XP_PER_RAID !== 'undefined' ? globalThis.MAX_XP_PER_RAID : 30000;


// Fallbacks for trimmed repo (constants may not exist).
const SAFE_MAX_XP_PER_RAID = typeof MAX_XP_PER_RAID === 'undefined' ? 30000 : MAX_XP_PER_RAID;
const SAFE_POINTS_CONFIG = typeof POINTS_CONFIG === 'undefined' ? {} : POINTS_CONFIG;

// Provide safe fallbacks for raid/task constants that may not exist in trimmed repo.
const DAILIES_LIST = [];
const WEEKLIES_LIST = [];
const TEMPLESHRINE_LIST = [];
const ORIGINUL_LIST = [];
const OTHERS_SEVEN_LIST = [];
const GENERIC_TASKS_LIST = [];
const LEGION_LIST = [];
const RAID_TASK_CATEGORIES = [];
const TASK_DISPLAY_NAMES = {};


// If the trimmed repo doesn’t export these raid/task constants, define fallbacks.
// This keeps gif/chart/general functionality booting.
const _DAILIES_LIST = typeof DAILIES_LIST !== 'undefined' ? DAILIES_LIST : [];
const _WEEKLIES_LIST = typeof WEEKLIES_LIST !== 'undefined' ? WEEKLIES_LIST : [];
const _TEMPLESHRINE_LIST = typeof TEMPLESHRINE_LIST !== 'undefined' ? TEMPLESHRINE_LIST : [];
const _ORIGINUL_LIST = typeof ORIGINUL_LIST !== 'undefined' ? ORIGINUL_LIST : [];
const _OTHERS_SEVEN_LIST = typeof OTHERS_SEVEN_LIST !== 'undefined' ? OTHERS_SEVEN_LIST : [];
const _GENERIC_TASKS_LIST = typeof GENERIC_TASKS_LIST !== 'undefined' ? GENERIC_TASKS_LIST : [];
const _LEGION_LIST = typeof LEGION_LIST !== 'undefined' ? LEGION_LIST : [];
const _RAID_TASK_CATEGORIES = typeof RAID_TASK_CATEGORIES !== 'undefined' ? RAID_TASK_CATEGORIES : [];
const _TASK_DISPLAY_NAMES = typeof TASK_DISPLAY_NAMES !== 'undefined' ? TASK_DISPLAY_NAMES : {};


function formatTasksForEmbed(taskList, pointsConfig) {
  if (!taskList || taskList.length === 0) return 'N/A';
  return taskList
    .map((task) => {
      const key = String(task).toLowerCase();
      const points = pointsConfig[key];
      const displayName = TASK_DISPLAY_NAMES?.[key] ?? task;
      return `\`${task}\` (${displayName}): ${points !== undefined ? `${points} EXP` : 'N/A'}`;
    })
    .join('\n');
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
          '`!raidtasks` - lists raid tasks by category\n' +
          '`/raidtasks` - slash version of raid tasks\n' +
          '`!calculatetask <task1> + <task2>...` - calculate EXP for tasks\n' +
          '`/calculatetask` - slash version of task calculation',
        inline: false,
      },
      {
        name: 'Inside Raid Tickets',
        value:
          '`!waiting` / `!ongoing` / `!full` - update raid status (requester/staff)\n' +
          '`!charts` or `/chart` - find available charts for ultras',
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
          'Press `Start Raid`, pick the category, press next and select the tasks, then fill in the details modal.\n' +
          'If your task is not listed, use **Generic** or **Spamming**:\n' +
          '* **Generic** — pick a 2/4/5/7-man room task and enter map name(s) in the raid form.\n' +
          '* **Spamming** — pick a 2/4/5/7-man spamming task and enter map name(s). EXP is time-based (300/min, cap 10,000).',
        inline: false,
      },
      {
        name: '3) During the Raid',
        value:
          'The status is automatically updated within the ticket. you can also type `!waiting`, `!ongoing`, or `!full` to update the status manually.\n' +
          '* The requester can also update the task or details if needed.\n' +
          '* Helpers can use **Kick** on their own row to leave the ticket.',
        inline: false,
      },
      {
        name: '4) Closing & Points',
        value:
          'Press `Close Raid`, select helpers, and optionally use `Partial Helper` to assign helpers to specific tasks for partial EXP.\n' +
          `* Max \`${MAX_XP_PER_RAID} EXP\` per player per raid.`,
        inline: false,
      },
      {
        name: '5) Leaderboard',
        value: `Use \`!leaderboard\`, \`!lbcheck\`, \`!lbcommands\` or \`/lb\` in <#${LEADERBOARD_CHANNEL_ID}>.`,
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
      { name: '5) Alt Accounts', value: 'Alt accounts can help, but the requester may ask for an alt to be removed if needed.', inline: false },
      {
        name: '6) Staff Discretion',
        value: `All <@&${MODERATOR_ROLE_ID}> and <@&${OFFICER_ROLE_ID}> may issue warnings/bans for misuse or misconduct.`,
        inline: false,
      },
      { name: '7) Follow Ticket Flow', value: 'Open/close tickets using the buttons and follow instructions.', inline: false },
    );
}

export function getRaidTasksPageCount() {
  return Math.max(1, Math.ceil((RAID_TASK_CATEGORIES?.length || 0) / 3));
}

export function getRaidTasksPageComponents(page = 0) {
  const pageCount = getRaidTasksPageCount();
  const safePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));

  return [
    new ActionRowBuilder().addComponents(
            
      new ButtonBuilder()
        .setCustomId(`raidtasks_first_${safePage}`)
        .setLabel('<<')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`raidtasks_prev_${safePage}`)
        .setLabel('<')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`raidtasks_next_${safePage}`)
        .setLabel('>')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
      new ButtonBuilder()
        .setCustomId(`raidtasks_last_${safePage}`)
        .setLabel('>>')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
    ),
  ];
}

export function getCombinedTasksAndPointsEmbed(page = 0) {
  const pointsConfig = typeof POINTS_CONFIG === 'undefined' ? SAFE_POINTS_CONFIG : POINTS_CONFIG;
  const fallbackCategories = [
    { label: 'Dailies', tasks: DAILIES_LIST },
    { label: 'Weeklies', tasks: WEEKLIES_LIST },
    { label: 'Temple Shrine', tasks: TEMPLESHRINE_LIST },
    { label: 'Originul', tasks: ORIGINUL_LIST },
    { label: 'Legion', tasks: LEGION_LIST },
    { label: '7-Man Extra', tasks: OTHERS_SEVEN_LIST },
    { label: 'Generic', tasks: GENERIC_TASKS_LIST },
  ];
  const categories = RAID_TASK_CATEGORIES?.length ? RAID_TASK_CATEGORIES : fallbackCategories;
  const pageCount = Math.max(1, Math.ceil(categories.length / 3));
  const safePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  const pageCategories = categories.slice(safePage * 3, safePage * 3 + 3);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Raid Tasks')
    .setDescription(`Use these task keys in /calculateTask or !calculatetask.\nPage ${safePage + 1}/${pageCount}`);

  for (const category of pageCategories) {
    embed.addFields({
      name: category.label || category.key || 'Tasks',
      value: formatTasksForEmbed(category.tasks || [], (typeof POINTS_CONFIG === 'undefined' ? SAFE_POINTS_CONFIG : POINTS_CONFIG)).slice(0, 1024),
      inline: false,
    });
  }

  return [embed];
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
    .setLabel('📘 Raid Tasks')
    .setStyle(ButtonStyle.Secondary);

  const showAllCommandsButton = new ButtonBuilder()
    .setCustomId('showAllCommands_btn')
    .setLabel('📙 Commands List')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(startRaidButton, getHelpRoleButton, seeRaidTasksButton, showAllCommandsButton);
}

// Legacy: kept for backwards compatibility (old !raidinfo flow).
export function getStringSelectMenu() {
  const raidTypeSelectMenu = new StringSelectMenuBuilder()
    .setCustomId('raidTypeSelect')
    .setPlaceholder('Select Room Type')
    .addOptions([
      { label: '4-man rooms', value: '4-man', description: 'Dailies, Weeklies, Speaker, Tyndarius, any 4-man rooms' },
      { label: '7-man rooms', value: '7-man', description: 'Mechabinky, kathool, Astralshrine, any 7-man rooms' },
      { label: 'Other rooms', value: 'other', description: "Select this if you're unsure about room size" },
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
`,
      },
      {
        name: 'EXP Check (1-3 days max)',
        value: `
\`!lbcheck [@user...] [today|yesterday|YYYY-MM-DD|from <start> to <end>]\`
\`/lb range:<input> users:<mentions>\` or \`/lb from:<YYYY-MM-DD> to:<YYYY-MM-DD>\`
**Example:** \`!lbcheck @user1 @user2 from 2026-04-01 to 2026-04-02\`
`,
      },
    )
    .setTimestamp()
    .setFooter({ text: 'Raid Helper Bot | Leaderboard Commands' });
}

export function getModeratorCommandsEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Moderator Commands List')
    .setDescription('This is shown using `!modcommands`.\nHere are the commands for moderation:')
    .addFields(
      {
        name: 'EXP Commands',
        value:
          '`/addxp @user <amount>` - Manually add EXP to user(s).\n' +
          '`/removexp @user <amount>` - Manually remove EXP from user(s).\n' +
          '`!resetlb [all]` - Resets the leaderboard (monthly automatic or force with `all`).\n' +
          '`!restorelb` - Restore leaderboard totals from a JSON backup (staff only).',
        inline: false,
      },
      {
        name: 'GIF/Text Commands',
        value:
          '`!addgif <triggerword>` / `/addgif` - Create a new GIF/Text command\n' +
          '`!editgif <triggerword>` / `/editgif` - Edit an existing GIF/Text command',
        inline: false,
      },
      {
        name: 'Charts',
        value: '`!editchart` or `/editchart` - Create/edit multi-page chart images',
        inline: false,
      },
      {
        name: 'Raid Tasks',
        value: '`/modifytasks` or `!managetasks` - Open the interactive raid task manager.\n`!removehelper` - Remove a joined helper from the current raid ticket.',
        inline: false,
      },
    )
    .setTimestamp()
    .setFooter({ text: 'Raid Helper Bot | Moderator Commands' });
}

export function getSecretCommandsEmbed(gifCommands, textGifCommands) {
  let secretGifCommandsList = '';

  for (const cmd in gifCommands) secretGifCommandsList += `* \`${cmd}\`\n`;
  for (const cmd in textGifCommands) secretGifCommandsList += `* \`${cmd}\`\n`;

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Secret Gif Commands List ')
    .setDescription('**Note:** These commands are for fun and may not be suitable for all audiences. Use them at your own discretion:')
    .addFields({
      name: 'Secret GIF Commands',
      value: secretGifCommandsList.trim() || 'No secret GIF commands configured.',
    })
    .setTimestamp()
    .setFooter({ text: 'Raid Helper Bot | Secret Gif Commands' });
}

export function createCustomGifEmbed(gifInfo) {
  const embed = new EmbedBuilder().setColor(gifInfo.color ?? EMBED_COLOR);

  const title = String(gifInfo.title ?? '').trim();
  if (title) embed.setTitle(title);

  const image = String(gifInfo.image ?? '').trim();
  if (image) embed.setImage(image);

  const footer = String(gifInfo.footer ?? '').trim();
  if (footer) embed.setFooter({ text: footer });

  return embed;
}
