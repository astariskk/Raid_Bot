// index.js

import './bootstrap/env.js';

import { startHealthServer } from './bootstrap/webServer.js';
import { createDiscordClient } from './bootstrap/discordClient.js';
import { registerBotReadyHandler } from './bootstrap/botReady.js';
import { registerProcessHandlers } from './bootstrap/processHandlers.js';

import dns from "dns";

dns.setServers([
  "8.8.8.8",
  "8.8.4.4"
]);

startHealthServer();

export const client = createDiscordClient();
registerBotReadyHandler(client);
registerProcessHandlers(client);

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('!!! FAILED TO LOGIN TO DISCORD (from .catch):');
  console.error(error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

