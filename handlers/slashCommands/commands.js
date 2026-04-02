// handlers/slashCommands/commands.js
import { ApplicationCommandOptionType } from 'discord.js';

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
];
