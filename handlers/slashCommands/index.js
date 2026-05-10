import { registerSlashCommands as registerCommands } from './register.js';
import { handleSlashCommandInteraction } from './setup.js';
import { handleChartsAutocompleteInteraction } from '../charts/charts.js';
import { handleEditGifAutocompleteInteraction, handleEditTaskAutocompleteInteraction } from './autocomplete.js';

export async function registerSlashCommands(client) {
    await registerCommands(client);
}

export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isAutocomplete?.()) {
            if (interaction.commandName === 'chart') {
                await handleChartsAutocompleteInteraction(interaction);
            }
            if (interaction.commandName === 'editgif') {
                await handleEditGifAutocompleteInteraction(interaction);
            }
            if (interaction.commandName === 'edittask') {
                await handleEditTaskAutocompleteInteraction(interaction);
            }
            return;
        }
        await handleSlashCommandInteraction(interaction, client);
    });
}
