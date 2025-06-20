// index.js
import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits } from 'discord.js';
import { setupRaidHandlers } from './handlers/raidHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';

// --- Configuration ---
export const RAID_CHANNEL_ID = '1385452423291600966';
export const RAID_LOGS_CHANNEL_ID = '1385452747544985682';
export const EXP_LAIR_CHANNEL_ID = '1385500247593193502';
export const RAID_HELPER_ROLE_ID = '1385471833192792115'; 

export const LEADERBOARD_FILE = 'leaderboard.json';
export const POINTS_CONFIG = {
    'weekly': 50000,
    'speaker': 20000,
    'daily': 10000
};

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
setupRaidHandlers(client);
setupLeaderboardHandlers(client);

// --- Login ---
client.login(process.env.DISCORD_TOKEN);