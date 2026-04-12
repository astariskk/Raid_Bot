// bootstrap/processHandlers.js
import { closeDB } from '../utils/dbOps.js';

export function registerProcessHandlers(client) {
  const exitOnFatal =
    !['1', 'true', 'yes'].includes(String(process.env.DISABLE_PROCESS_EXIT ?? '').toLowerCase());

  const shutdown = async (signal) => {
    console.log(`Bot is shutting down (${signal})...`);
    await closeDB();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
    console.error('Unhandled Rejection Stack:', reason?.stack);
    if (exitOnFatal) process.exit(1);
    console.error('DISABLE_PROCESS_EXIT is enabled; keeping process alive after unhandled rejection.');
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error('Uncaught Exception Stack:', error?.stack);
    if (exitOnFatal) process.exit(1);
    console.error('DISABLE_PROCESS_EXIT is enabled; keeping process alive after uncaught exception.');
  });
}
