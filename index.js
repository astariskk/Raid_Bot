// Add this at the top of your main bot file
import express from 'express';
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// index.js
import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits } from 'discord.js';
import { setupRaidLogsHandlers } from './handlers/raidLogsHandler.js';
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
import { RAID_CHANNEL_ID, RAID_LOGS_CHANNEL_ID, EXP_LAIR_CHANNEL_ID, RAID_HELPER_ROLE_ID } from './config/constants.js'; // Centralized constants

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- Bot Ready Event ---
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online!');
    console.log('Ready to process commands and interactions.');
});

// --- Initialize Handlers ---
setupRaidLogsHandlers(client); // Setup for raid request and logging
setupExpLairHandlers(client);   // Setup for raid completion and EXP awarding
setupLeaderboardHandlers(client);

// --- Login ---
client.login(process.env.DISCORD_TOKEN);