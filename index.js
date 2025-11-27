// index.js
import dotenv from "dotenv";
dotenv.config();

// --- Import necessary for online hosting ---
import express from 'express';
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
    // Log when the health check endpoint is hit
    console.log('Health check endpoint (/) hit by Render.'); // NEW LOG
    res.send('Bot is alive!');
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});


import { Client, GatewayIntentBits } from 'discord.js';
import { setupRaidTicketHandler } from './handlers/raidTicketHandler.js';
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
import { setupGeneralCommandsHandler } from './handlers/generalCommandsHandler.js';
import { setupBackupHandlers } from './handlers/backupHandler.js';
import { registerSlashCommands, setupSlashCommandsHandler } from './handlers/slashCommandsHandler.js';

// Import the MongoDB connection function
import { connectDB, closeDB } from './utils/dbOps.js';

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
client.on('ready', async () => { // Make ready event async
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        await connectDB();
        console.log('Database connection established for bot operations.');

        // --- Register and Setup Slash Commands ---
        await registerSlashCommands(client); // Call the new registration function
        setupSlashCommandsHandler(client);   // Call the new handler setup function

        // --- Initialize Other Handlers AFTER DB connection ---
        setupRaidTicketHandler(client);
        setupExpLairHandlers(client);
        setupLeaderboardHandlers(client);
        setupGeneralCommandsHandler(client);
        setupBackupHandlers(client);
        console.log('All handlers done, Bot is fully ready');

    } catch (error) {
        console.error('Failed to start bot due to database connection error:', error);
        // Log the specific error that caused the database connection failure
        console.error('Error details:', error.stack); // Add stack trace for more info
        process.exit(1); // Exit if DB connection fails
    }
});

// --- Handle graceful shutdown ---
process.on('SIGINT', async () => {
    console.log('Bot is shutting down (SIGINT)...');
    await closeDB();
    client.destroy();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Bot is shutting down (SIGTERM)...');
    await closeDB();
    client.destroy();
    process.exit(0);
});

// --- Global Error Handlers (NEWLY ADDED) ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
    console.error('Unhandled Rejection Stack:', reason.stack); 
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error('Uncaught Exception Stack:', error.stack); 
    process.exit(1);
});


// --- Login ---

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!!! FAILED TO LOGIN TO DISCORD (from .catch):');
    console.error(error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

