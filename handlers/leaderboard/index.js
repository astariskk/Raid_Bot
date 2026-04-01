import { handleLeaderboardButtonInteraction, handleLeaderboardMessage, startLeaderboardTasks } from './setup.js';

export function setupLeaderboardHandlers(client) {
    client.on('messageCreate', async (message) => {
        await handleLeaderboardMessage(message, client);
    });

    client.on('interactionCreate', async (interaction) => {
        await handleLeaderboardButtonInteraction(interaction, client);
    });

    startLeaderboardTasks(client);
}
