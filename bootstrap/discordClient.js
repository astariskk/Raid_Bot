// bootstrap/discordClient.js
export async function createDiscordClient() {
  const { Client, GatewayIntentBits } = await import('discord.js');

  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

