// index.js

import './bootstrap/env.js';

import { startHealthServer } from './bootstrap/webServer.js';
import { createDiscordClient } from './bootstrap/discordClient.js';
import { registerBotReadyHandler } from './bootstrap/botReady.js';
import { registerProcessHandlers } from './bootstrap/processHandlers.js';
import { registerDiscordDiagnostics } from './bootstrap/discordDiagnostics.js';

/* 
import dns from "dns";
dns.setServers([
  "8.8.8.8",
  "8.8.4.4"
]);
*/

startHealthServer();

export const client = createDiscordClient();
registerBotReadyHandler(client);
registerProcessHandlers(client);
registerDiscordDiagnostics(client);

const exists = (value) => (value ? 'EXISTS' : 'MISSING');
console.log('[env] DISCORD_TOKEN:', exists(process.env.DISCORD_TOKEN));
console.log('[env] SUPABASE_URL:', exists(process.env.SUPABASE_URL));
console.log(
  '[env] SUPABASE_KEY:',
  exists(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
);

const exitOnFatal =
  !['1', 'true', 'yes'].includes(String(process.env.DISABLE_PROCESS_EXIT ?? '').toLowerCase());

const readyTimeoutMs = Number(process.env.DISCORD_READY_TIMEOUT_MS ?? 30000);
setTimeout(() => {
  const isReady = typeof client.isReady === 'function' ? client.isReady() : Boolean(client.readyAt);
  if (!isReady) {
    console.warn(
      `[discord] Still not ready after ${readyTimeoutMs}ms. If this persists, check token/env and network/DNS.`,
    );
  }
}, readyTimeoutMs);

client
  .login(process.env.DISCORD_TOKEN)
  .then(() => console.log('[discord] Login promise resolved.'))
  .catch((error) => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!!! FAILED TO LOGIN TO DISCORD (login promise rejected):');
    console.error(error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    if (exitOnFatal) process.exit(1);
    console.error('DISABLE_PROCESS_EXIT is enabled; bot will stay running for debugging.');
  });

