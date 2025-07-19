// handlers/slashCommandsHandler.js
import { REST, Routes, ApplicationCommandOptionType, EmbedBuilder, MessageFlags } from 'discord.js';
// No other constants are needed for just ping and echo
// No other imports from generalCommandsHandler or leaderboardCore or backupHandler or activeRaidState are needed

// Define your slash commands
const commands = [
    {
        name: 'ping',
        description: 'Checks if the bot is running!',
    },
    {
        name: 'echo',
        description: 'Repeats your message back to you.',
        options: [
            {
                name: 'message',
                description: 'The message to echo.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
];

/**
 * Registers slash commands with Discord's API.
 * This function should be called once when the bot starts.
 * @param {Client} client The Discord client instance.
 */
export async function registerSlashCommands(client) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.time('Slash Command Registration API Call'); // Start timer for API call
        console.log('Started refreshing application (/) commands.');
        // Register commands globally. For specific guilds, use Routes.applicationGuildCommands(clientId, guildId)
        await rest.put(
            Routes.applicationCommands(client.user.id), // Global commands
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
        console.timeEnd('Slash Command Registration API Call'); // End timer
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

        // NEW LOGS: More detailed logging around deferral attempt
        console.log(`[Interaction] Received command: /${interaction.commandName} (ID: ${interaction.id})`);
        console.log(`[Interaction] isReplied: ${interaction.replied}, isDeferred: ${interaction.deferred}`);
        console.time(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);

        // Defer reply for commands that might take longer, or for conditional ephemeral replies
        // Use flags instead of ephemeral for deprecation warning fix
        try {
            await interaction.deferReply({ flags: [] }); // Default to public, can be overridden
            console.timeEnd(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);
            console.log(`[Interaction] Successfully deferred /${interaction.commandName} (ID: ${interaction.id})`);
        } catch (error) {
            console.timeEnd(`Deferral for ${interaction.commandName} (ID: ${interaction.id})`);
            console.error(`[Interaction Error] Failed to defer reply for /${interaction.commandName} (ID: ${interaction.id}):`, error);
            // If deferral fails, it means Discord has already invalidated the interaction.
            // We cannot reply or followUp to it anymore.
            return; // Exit here to prevent further errors
        }

        switch (interaction.commandName) {
            case 'ping':
                try {
                    await interaction.editReply('Bot is running!');
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`); // NEW LOG
                } catch (error) {
                    console.error('Error replying to ping command:', error);
                    // Fallback to followUp if initial reply fails, or just log
                    if (!interaction.replied && !interaction.deferred) { // This check is now mostly redundant after deferReply try/catch
                        await interaction.followUp({ content: 'There was an error trying to respond to this command.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            case 'echo':
                try {
                    const messageToEcho = interaction.options.getString('message');
                    await interaction.editReply({ content: messageToEcho });
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`); // NEW LOG
                } catch (error) {
                    console.error('Error replying to echo command:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error trying to echo your message.', flags: MessageFlags.Ephemeral });
                    }
                }
                break;

            default:
                console.log(`Unhandled slash command: ${interaction.commandName}`);
                // If the reply was deferred, edit it. Otherwise, followUp.
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral }).catch(e => console.error("Error editing unknown command reply:", e));
                } else {
                    await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral }).catch(e => console.error("Error replying to unknown command:", e));
                }
                break;
        }
    });
}
