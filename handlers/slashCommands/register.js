// handlers/slashCommands/register.js
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

export async function registerSlashCommands(client) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
}

