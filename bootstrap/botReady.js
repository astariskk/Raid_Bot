// bootstrap/botReady.js
import { setupRaidHandlers } from '../handlers/raidTickets/index.js';
import { setupLeaderboardHandlers } from '../handlers/leaderboard/index.js';
import { setupGeneralCommandsHandler } from '../handlers/generalCommands/index.js';
import { setupBackupHandlers } from '../handlers/backup/index.js';
import { registerSlashCommands, setupSlashCommandsHandler } from '../handlers/slashCommands/index.js';

import { connectDB } from '../utils/dbOps.js';

export function registerBotReadyHandler(client) {
  let didSetup = false;

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
      if (didSetup) return;
      didSetup = true;

      await connectDB();
      console.log('Database connection established for bot operations.');

      await registerSlashCommands(client);
      setupSlashCommandsHandler(client);

      setupRaidHandlers(client);
      setupLeaderboardHandlers(client);
      setupGeneralCommandsHandler(client);
      setupBackupHandlers(client);

      console.log('All handlers done, Bot is fully ready');
    } catch (error) {
      console.error('Failed to start bot due to database connection error:', error);
      console.error('Error details:', error?.stack);
      process.exit(1);
    }
  });
}
