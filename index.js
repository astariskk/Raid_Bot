// index.js
import dotenv from "dotenv";
dotenv.config();

// --- Import necessary for online hosting ---
import express from 'express';
const app = express();
const port = process.env.PORT || 3000; // Use process.env.PORT for Render.com compatibility
app.get('/', (req, res) => {
    res.send('Bot is alive!');
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});


import { Client, GatewayIntentBits } from 'discord.js'; // Removed EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle as they are no longer directly used here
import { setupRaidLogsHandlers } from './handlers/raidLogsHandler.js';
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
import { setupGeneralCommandsHandler } from './handlers/generalCommandsHandler.js'; // New import for the general commands handler

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers, // REQUIRED for role management
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
});


// --- Bot Ready Event ---
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online!');
    console.log('Ready to process commands and interactions.');

    // --- Initialize Handlers ---
    setupRaidLogsHandlers(client);
    setupExpLairHandlers(client);
    setupLeaderboardHandlers(client);
    setupGeneralCommandsHandler(client); // Call the new general commands handler setup function
});

// --- Login ---
client.login(process.env.DISCORD_TOKEN);
