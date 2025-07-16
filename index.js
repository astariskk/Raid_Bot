// index.js
import dotenv from "dotenv";
dotenv.config();

console.log('MONGODB_URI from env:', process.env.MONGODB_URI);

// --- Import necessary for online hosting ---
import express from 'express';
const app = express();
const port = process.env.PORT || 3000; 
app.get('/', (req, res) => {
    res.send('Bot is alive!');
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});


import { Client, GatewayIntentBits } from 'discord.js';
import { setupRaidLogsHandlers } from './handlers/raidLogsHandler.js';
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
import { setupGeneralCommandsHandler } from './handlers/generalCommandsHandler.js';
import { setupBackupHandlers } from './handlers/backupHandler.js';

// Import the MongoDB connection function
import { connectDB, closeDB } from './utils/dbOps.js';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.MessageContent, 
    ],
});


// --- Bot Ready Event ---
client.on('ready', async () => { // Make ready event async
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online!');

    try {
        await connectDB(); 
        console.log('Database connection established for bot operations.');

        // --- Initialize Handlers AFTER DB connection ---
        setupRaidLogsHandlers(client);
        setupExpLairHandlers(client);
        setupLeaderboardHandlers(client); 
        setupGeneralCommandsHandler(client);
        setupBackupHandlers(client); 
        console.log('All handlers initialized.');
        console.log('Ready to process commands and interactions.');

    } catch (error) {
        console.error('Failed to start bot due to database connection error:', error);
        process.exit(1); // Exit if DB connection fails
    }
});

// --- Handle graceful shutdown ---
process.on('SIGINT', async () => {
    console.log('Bot is shutting down...');
    await closeDB(); 
    client.destroy(); 
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Bot is shutting down...');
    await closeDB(); 
    client.destroy(); 
    process.exit(0);
});


// --- Login ---
client.login(process.env.DISCORD_TOKEN);
