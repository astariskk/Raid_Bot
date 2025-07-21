// handlers/slashCommandsHandler.js
import { REST, Routes, ApplicationCommandOptionType, MessageFlags } from 'discord.js';

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
        console.time('Slash Command Registration API Call');
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
        console.timeEnd('Slash Command Registration API Call');
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

        console.log(`[Interaction] Received command: /${interaction.commandName} (ID: ${interaction.id})`);
        console.log(`[Interaction] isReplied: ${interaction.replied}, isDeferred: ${interaction.deferred}`);

        switch (interaction.commandName) {
            case 'ping':
                try {
                    await interaction.reply('Bot is running!');
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`);
                } catch (error) {
                    console.error('Error replying to ping command:', error);
                    if (!interaction.replied) {
                        await interaction.reply({ // Changed from editReply to reply (if it was ever editReply)
                            content: 'There was an error trying to respond to this command.',
                            flags: MessageFlags.Ephemeral
                        }).catch(e => console.error('Failed to send fallback reply:', e));
                    }
                }
                break;

            case 'echo':
                try {
                    const messageToEcho = interaction.options.getString('message');
                    await interaction.reply({ content: messageToEcho });
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`);
                } catch (error) {
                    console.error('Error replying to echo command:', error);
                    if (!interaction.replied) {
                        await interaction.reply({ // Changed from editReply to reply (if it was ever editReply)
                            content: 'There was an error trying to echo your message.',
                            flags: MessageFlags.Ephemeral
                        }).catch(e => console.error('Failed to send fallback reply:', e));
                    }
                }
                break;

            default:
                console.log(`Unhandled slash command: ${interaction.commandName}`);
                await interaction.reply({
                    content: 'Unknown command.',
                    flags: MessageFlags.Ephemeral
                }).catch(e => console.error('Error replying to unknown command:', e));
                break;
        }
    });
}
