// handlers/slashCommandsHandler.js
import { REST, Routes } from 'discord.js';

// Define your slash commands
const commands = [
    {
        name: 'ping',
        description: 'Checks if the bot is running!',
    },
    // Add more slash commands here if you create them
];

/**
 * Registers slash commands with Discord's API.
 * This function should be called once when the bot starts.
 * @param {Client} client The Discord client instance.
 */
export async function registerSlashCommands(client) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');
        // Register commands globally. For specific guilds, use Routes.applicationGuildCommands(clientId, guildId)
        await rest.put(
            Routes.applicationCommands(client.user.id), // Global commands
            // Routes.applicationGuildCommands(client.user.id, 'YOUR_GUILD_ID'), // For specific guild
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error refreshing application (/) commands:', error);
    }
}

/**
 * Sets up the interaction listener for slash commands.
 * This function should be called once when the bot starts.
 * @param {Client} client The Discord client instance.
 */
export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async interaction => {
        // Only handle chat input commands
        if (!interaction.isChatInputCommand()) return;

        switch (interaction.commandName) {
            case 'ping':
                try {
                    await interaction.reply('Bot is running!');
                } catch (error) {
                    console.error('Error replying to ping command:', error);
                    // Fallback to followUp if initial reply fails, or just log
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.followUp('There was an error trying to respond to this command.');
                    }
                }
                break;
            // Add more cases for other slash commands here
            default:
                console.log(`Unhandled slash command: ${interaction.commandName}`);
                break;
        }
    });
}
