// bootstrap/botReady.js
import { setupRaidHandlers } from '../handlers/raidTickets/index.js';
import { setupLeaderboardHandlers } from '../handlers/leaderboard/index.js';
import { setupGeneralCommandsHandler } from '../handlers/generalCommands/index.js';
import { setupBackupHandlers } from '../handlers/backup/index.js';
import { registerSlashCommands, setupSlashCommandsHandler } from '../handlers/slashCommands/index.js';

import { connectDB } from '../utils/dbOps.js';

export function registerBotReadyHandler(client) {
  let didSetup = false;
  const exitOnReadyFailure =
    !['1', 'true', 'yes'].includes(String(process.env.DISABLE_PROCESS_EXIT ?? '').toLowerCase());

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
      if (didSetup) return;
      didSetup = true;

      console.log('[startup] Initializing DB client...');
      await connectDB();
      console.log('[startup] DB init complete.');

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
      if (exitOnReadyFailure) process.exit(1);
      console.error('DISABLE_PROCESS_EXIT is enabled; bot will stay running for debugging.');
    }
  });
}
