// handlers/slashCommands/commands.js
import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord.js';

export const commands = [
  {
    name: 'lb',
    description: 'Show the leaderboard or check EXP for a date range.',
    options: [
      {
        name: 'range',
        description: 'Optional: today, yesterday, 15, from 10 to 15, or YYYY-MM-DD',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'from',
        description: 'Optional start date (YYYY-MM-DD) for a range',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'to',
        description: 'Optional end date (YYYY-MM-DD) for a range',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'users',
        description: 'Optional mentions, e.g. <@123> <@456>',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: 'ping',
    description: 'Checks if the bot is running!',
  },
  {
    name: 'addxp',
    description: 'Add XP to one or more users.',
    options: [
      {
        name: 'users',
        description: 'User(s) to award XP to',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'amount',
        description: 'Amount of XP to add',
        type: ApplicationCommandOptionType.Integer,
        required: true,
      },
    ],
  },
  {
    name: 'removexp',
    description: 'Remove XP from one or more users.',
    options: [
      {
        name: 'users',
        description: 'User(s) to deduct XP from',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'amount',
        description: 'Amount of XP to remove',
        type: ApplicationCommandOptionType.Integer,
        required: true,
      },
    ],
  },
  {
    name: 'calculatetask',
    description: 'Calculate EXP for one or more tasks.',
    options: [
      {
        name: 'tasks',
        description: 'e.g. "kathool, voidnerfkitten x5 + voidxyfrag"',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'raidtasks',
    description: 'Show raid tasks and EXP values.',
  },
  {
    name: 'addgif',
    description: 'Create a new GIF/Text command (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'command',
        description: 'New command name (without the slash), e.g. "bonk"',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'addcommand',
    description: 'Create a new GIF/Text command (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'command',
        description: 'New command name (without the slash), e.g. "bonk"',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'editgif',
    description: 'Edit an existing GIF/Text command (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'command',
        description: 'Existing command name (without the slash), e.g. "bonk"',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'addtask',
    description: 'Add a raid task to Supabase (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'display_name',
        description: 'Task name shown in menus/embeds, e.g. "Ultra Dage"',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'points',
        description: 'EXP points for this task',
        type: ApplicationCommandOptionType.Integer,
        required: true,
      },
      {
        name: 'category',
        description: 'Category key/name. New values create new task categories.',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'available',
        description: 'Whether this task can be selected',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
      {
        name: 'key',
        description: 'Optional internal key. Defaults from display name.',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'map_name',
        description: 'Map name(s), comma-separated for multiple maps',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'task_alias',
        description: 'Alias(es) used to detect tasks/maps, comma-separated',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'description',
        description: 'Short task description for the Start Raid modal',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'sort_order',
        description: 'Lower numbers appear first',
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },
  {
    name: 'edittask',
    description: 'Edit a raid task in Supabase (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'task',
        description: 'Existing task key or display name',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
      {
        name: 'points',
        description: 'EXP points for this task',
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
      {
        name: 'available',
        description: 'Whether this task can be selected',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
      {
        name: 'map_name',
        description: 'Replace map name(s), comma-separated for multiple maps',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'task_alias',
        description: 'Replace alias(es) used to detect tasks/maps, comma-separated',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'category',
        description: 'Category key/name. New values create new task categories.',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'description',
        description: 'Short task description for the Start Raid modal',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'sort_order',
        description: 'Lower numbers appear first',
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },
  {
    name: 'editchart',
    description: 'Edit/remove existing chart pages (staff only).',
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
  },
  {
    name: 'chart',
    description: 'Browse charts by category.',
    dm_permission: false,
    options: [
      {
        name: 'category',
        description: 'Category (autocomplete)',
        type: ApplicationCommandOptionType.String,
        required: false,
        autocomplete: true,
      },
      {
        name: 'chart',
        description: 'Type (autocomplete)',
        type: ApplicationCommandOptionType.String,
        required: false,
        autocomplete: true,
      },
    ],
  },
];
