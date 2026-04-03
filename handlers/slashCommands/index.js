import { registerSlashCommands as registerCommands } from './register.js';
import { handleSlashCommandInteraction } from './setup.js';
import { handleChartsAutocompleteInteraction } from '../charts/charts.js';

export async function registerSlashCommands(client) {
    await registerCommands(client);
}

export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isAutocomplete?.()) {
            if (interaction.commandName === 'charts' || interaction.commandName === 'chart') {
                await handleChartsAutocompleteInteraction(interaction);
            }
            return;
        }
        await handleSlashCommandInteraction(interaction, client);
    });
}
