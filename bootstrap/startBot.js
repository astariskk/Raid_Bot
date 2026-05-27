import { startHealthServer } from './webServer.js';
import { createDiscordClient } from './discordClient.js';
import { registerBotReadyHandler } from './botReady.js';
import { registerProcessHandlers } from './processHandlers.js';
import { registerDiscordDiagnostics } from './discordDiagnostics.js';
import { logDiscordConnectivity } from './networkDiagnostics.js';
import { configureNetworkFromEnv } from './networkSetup.js';
import { configureDebugFromEnv } from './debugSetup.js';

function exists(value) {
  return value ? 'EXISTS' : 'MISSING';
}

export async function startBot() {
  configureDebugFromEnv();
  configureNetworkFromEnv();

  startHealthServer();

  const client = await createDiscordClient();
  registerBotReadyHandler(client);
  registerProcessHandlers(client);
  registerDiscordDiagnostics(client);

  console.log('[env] DISCORD_TOKEN:', exists(process.env.DISCORD_TOKEN));
  console.log('[env] MONGODB_URI:', exists(process.env.MONGODB_URI));
  console.log('[env] MONGODB_DB:', exists(process.env.MONGODB_DB));

  const exitOnFatal =
    !['1', 'true', 'yes'].includes(String(process.env.DISABLE_PROCESS_EXIT ?? '').toLowerCase());

  const readyTimeoutMs = Number(process.env.DISCORD_READY_TIMEOUT_MS ?? 30000);
  const loginTimeoutMs = Number(process.env.DISCORD_LOGIN_TIMEOUT_MS ?? 30000);
  let loginSettled = false;
  let loginResolved = false;

  setTimeout(() => {
    const isReady = typeof client.isReady === 'function' ? client.isReady() : Boolean(client.readyAt);
    if (!isReady) {
      console.warn(
        `[discord] Still not ready after ${readyTimeoutMs}ms (loginSettled=${loginSettled}, loginResolved=${loginResolved}). If this persists, check network/DNS and token validity.`,
      );
    }
  }, readyTimeoutMs);

  setTimeout(() => {
    if (!loginSettled) {
      console.warn(
        `[discord] Login promise still pending after ${loginTimeoutMs}ms. This usually indicates gateway connect/DNS/TLS issues rather than an invalid token.`,
      );
    }
  }, loginTimeoutMs);

  // Optional connectivity probes (requires DISCORD_DIAGNOSTICS=1)
  logDiscordConnectivity().catch((e) => console.warn('[net] diagnostics failed:', e?.message ?? e));

  client
    .login(process.env.DISCORD_TOKEN)
    .then(() => {
      loginSettled = true;
      loginResolved = true;
      console.log('[discord] Login promise resolved.');
    })
    .catch((error) => {
      loginSettled = true;
      loginResolved = false;
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.error('!!! FAILED TO LOGIN TO DISCORD (login promise rejected):');
      console.error(error);
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      if (exitOnFatal) process.exit(1);
      console.error('DISABLE_PROCESS_EXIT is enabled; bot will stay running for debugging.');
    });

  return client;
}

