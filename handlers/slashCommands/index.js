import { registerSlashCommands as registerCommands } from './register.js';
import { handleSlashCommandInteraction } from './setup.js';

export async function registerSlashCommands(client) {
    await registerCommands(client);
}

export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async (interaction) => {
        await handleSlashCommandInteraction(interaction, client);
    });
}
