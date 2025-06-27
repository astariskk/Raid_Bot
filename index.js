// remove for online hosting
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

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'; // Import ButtonBuilder and ActionRowBuilder

import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js'; // Import EmbedBuilder
import { setupRaidLogsHandlers } from './handlers/raidLogsHandler.js';
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
// Centralized constants are not directly used in index.js for bot logic, so they can be removed if not needed here.
// import { RAID_CHANNEL_ID, RAID_LOGS_CHANNEL_ID, EXP_LAIR_CHANNEL_ID, RAID_HELPER_ROLE_ID } from './config/constants.js';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent, // REQUIRED for accessing message.content (Discord.js v13+)
    ],
});

// --- Buttons ---
const helpButton = new ButtonBuilder()
    .setCustomId("showHelpModal")
    .setLabel('🏹 Help')
    .setStyle(ButtonStyle.Primary); 

const helpButtonRow = new ActionRowBuilder()
    .addComponents(helpButton);

// --- Bot Ready Event ---
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online!');
    console.log('Ready to process commands and interactions.');

    // --- Initialize Handlers ---
    setupRaidLogsHandlers(client); // Setup for raid request and logging
    setupExpLairHandlers(client);   // Setup for raid completion and EXP awarding
    setupLeaderboardHandlers(client);
    setupCommandsHandler(client); // Setup the new !commands handler
});

/**
 * Sets up the handler for the !commands command.
 * @param {Client} client The Discord client instance.
 */
function setupCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        // Ignore messages from bots to prevent infinite loops
        if (message.author.bot) return;

        // Handle the !commands command
        if (message.content.toLowerCase() === '!commands') {
            const commandsEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // A nice blue color
                .setTitle('✨ Bot Commands List ✨')
                .setDescription('Here are the commands you can use with the Raid Helper Bot:')
                .addFields(
                    {
                        name: '📊 General Raid & Status Commands',
                        value: `
\`!raidtasks\`: Lists all available raid tasks and their EXP values.
                        `
                    },
                    {
                        name: '💬 Commands Inside Raid Threads (by Raid Requester)',
                        value: `
\`waiting\`: Set the raid status to '🔵 Waiting'.
\`full\`: Set the raid status to '🔴 Full'.
\`cancel\`: Close the raid thread without awarding points.
\`all\`: Awards EXP for all tasks included in the original raid request to the tagged player(s)..
                        `
                    },
                    {
                        name: '⚔️ Boss Mechanic Charts (Inside Raid Threads)',
                        value: `
\`!1man\`: Displays the 1-man raid chart.
\`!2man\`: Displays the 2-man raid chart.
\`!3man\`: Displays the 3-man raid chart.
\`!4man\`: Displays the 4-man raid chart.
                        `
                    },
                    {
                        name: '🏆 Leaderboard & Points Check',
                        value: `
\`!leaderboard\`: Displays the current top 10 players by total EXP.
\`!checkrewards [today|yesterday|YYYY-MM-DD] [@user]\`: Shows EXP gained on a specific day (overall or for a specific user).
                        `
                    },
                    {
                        name: '🛡️ Moderator Commands (Administrator Only)',
                        value: `
\`!raidhelp\`: Shows a button to request raid assistance (in raid channel).                      
\`!addxp @user <amount>\`: Manually adds EXP to a specified user.
\`!removexp @user <amount>\`: Manually removes EXP from a specified user.
\`!reset [all]\`: Resets the leaderboard (monthly automatic or force with \`all\`).
\`!checkrewards [today|yesterday|YYYY-MM-DD] [@user]\`: Shows EXP gained on a specific day (overall or for a specific user).
                        `
                    }
                )
                .setTimestamp() // Show when the command was run
                .setFooter({ text: 'Raid Helper Bot | Your ultimate raid companion!' });
            try {
                await message.channel.send({
                     embeds: [commandsEmbed]
                    });
            } catch (error) {
                console.error('Error sending !commands embed:', error);
                await message.channel.send('Failed to display commands. Please try again later.');
            }
        }

        if (message.content === 'The Most Beautiful Thing You Will Ever See') {
            const gifEmbed = new EmbedBuilder()
                .setColor(0xFF0000) //Red color
                .setTitle('The Most Beautiful Thing You will Ever See')
                .setImage('https://files.catbox.moe/7wwm4n.gif') 
                .setFooter({ text: 'Feast your eyes on this' });
            try {
                const sentMessage = await message.channel.send({ embeds: [gifEmbed] });
                setTimeout(async () => {
                    try {
                        await sentMessage.delete();
                        //delete the user's original message after the GIF is gone
                        await message.delete(); 
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 7000); // 10000 milliseconds = 10 seconds

            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }

        if (message.content === 'I Need More Bullets') {
            const gifEmbed = new EmbedBuilder()
                .setColor(0x006400) // Green color
                .setTitle("Asta La Vista, Baby")
                .setImage('https://files.catbox.moe/dnzecs.gif') 
                .setFooter({ text: 'He needs more bullets' });
            try {
                // Send the message and store the returned message object
                const sentMessage = await message.channel.send({ embeds: [gifEmbed] });

                // Set a timeout to delete the message after 10 seconds (10000 milliseconds)
                setTimeout(async () => {
                    try {
                        await sentMessage.delete();
                        //delete the user's original message after the GIF is gone                        
                        await message.delete(); 
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 13000); // 10000 milliseconds = 10 seconds

            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }

        if (message.content === 'Sybau Xychrome') {
            const gifEmbed = new EmbedBuilder()
                .setColor(0x7e7e7e) // Green color
                .setTitle("Get Twerked On")
                .setImage('https://files.catbox.moe/neo4gz.gif') 
                .setFooter({ text: 'Deal with it' });
            try {
                // Send the message and store the returned message object
                const sentMessage = await message.channel.send({ embeds: [gifEmbed] });

                // Set a timeout to delete the message after 10 seconds (10000 milliseconds)
                setTimeout(async () => {
                    try {
                        await sentMessage.delete();
                        //delete the user's original message after the GIF is gone                        
                        await message.delete(); 
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 5000); // 10000 milliseconds = 10 seconds

            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }        
        
    });
}

// --- Login ---
client.login(process.env.DISCORD_TOKEN);
