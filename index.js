import express from 'express';
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'; // Import necessary components
import { setupRaidLogsHandlers, getTasksEmbed, getPointsEmbed, getRaidRequestModal } from './handlers/raidLogsHandler.js'; // Import new functions
import { setupExpLairHandlers } from './handlers/expLairHandler.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandler.js';
import { RAID_CHANNEL_ID } from './config/constants.js'; // Import RAID_CHANNEL_ID for button logic

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent, // REQUIRED for accessing message.content (Discord.js v13+)
    ],
});

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
 * Sets up the handler for the !commands command and associated buttons.
 * @param {Client} client The Discord client instance.
 */
function setupCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        // Ignore messages from bots to prevent infinite loops
        if (message.author.bot) return;

        // --- Handle the !commands command ---
        if (message.content.toLowerCase() === '!commands') {
            // --- Define new buttons for the !commands embed ---
            const getHelpRoleButton = new ButtonBuilder()
                .setCustomId('getHelpRole_btn')
                .setLabel('📣 Get Help Role')
                .setStyle(ButtonStyle.Secondary); // A subtle style

            const startRaidButton = new ButtonBuilder()
                .setCustomId('startRaid_btn')
                .setLabel('⚔️ Start Raid')
                .setStyle(ButtonStyle.Primary); // Prominent for starting a raid

            const seeRaidTasksButton = new ButtonBuilder()
                .setCustomId('seeRaidTasks_btn')
                .setLabel('📋 See Raid Tasks')
                .setStyle(ButtonStyle.Secondary);

            const howToUseButton = new ButtonBuilder()
                .setCustomId('howToUse_btn')
                .setLabel('❓ How to Use')
                .setStyle(ButtonStyle.Secondary);

            const commandButtonsRow = new ActionRowBuilder()
                .addComponents(getHelpRoleButton, startRaidButton, seeRaidTasksButton, howToUseButton);

            const commandsEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // A nice blue color
                .setTitle('✨ Bot Commands List ✨')
                .setDescription('Here are the commands you can use with the Raid Helper Bot:')
                .addFields(
                    {
                        name: '📊 General Raid & Status Commands',
                        value: `
\`!raidtasks\`: Lists all available raid tasks and their EXP values.
\`!raidpoints\`: Displays the EXP values for all configured raid tasks.
                        `
                    },
                    {
                        name: '💬 Commands Inside Raid Threads (by Raid Requester)',
                        value: `
\`waiting\`: Set the raid status to '🔵 Waiting'.
\`full\`: Set the raid status to '🔴 Full'.
\`cancel\`: Close the raid thread without awarding points.
\`all\`: Awards EXP for all tasks included in the original raid request to the tagged player(s).
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
                        `
                    }
                )
                .setTimestamp() // Show when the command was run
                .setFooter({ text: 'Raid Helper Bot | Your ultimate raid companion!' });

            try {
                await message.channel.send({ embeds: [commandsEmbed], components: [commandButtonsRow] });
            } catch (error) {
                console.error('Error sending !commands embed:', error);
                await message.channel.send('Failed to display commands. Please try again later.');
            }
        }

        // --- Custom GIF Commands (from your original code) ---
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
                        await message.delete(); // Delete the user's original message after the GIF is gone
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 7000); // 7 seconds
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
                const sentMessage = await message.channel.send({ embeds: [gifEmbed] });
                setTimeout(async () => {
                    try {
                        await sentMessage.delete();
                        await message.delete();
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 13000); // 13 seconds
            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }

        if (message.content === 'Sybau Xychrome') {
            const gifEmbed = new EmbedBuilder()
                .setColor(0x7e7e7e) // Gray color
                .setTitle("Get Twerked On")
                .setImage('https://files.catbox.moe/neo4gz.gif')
                .setFooter({ text: 'Deal with it' });
            try {
                const sentMessage = await message.channel.send({ embeds: [gifEmbed] });
                setTimeout(async () => {
                    try {
                        await sentMessage.delete();
                        await message.delete();
                    } catch (deleteError) {
                        console.error('Error deleting custom GIF message:', deleteError);
                    }
                }, 5000); // 5 seconds
            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }
    });

    // --- Interaction Create Listener for the new buttons ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return; // Only handle button interactions

        switch (interaction.customId) {
            case 'getHelpRole_btn':
                await interaction.reply({
                    content: `To request raid assistance, please go to the <#${RAID_CHANNEL_ID}> channel and click the "🏹 Help" button there, or ask a moderator to use \`!raidhelp\`. If you are interested in becoming a Raid Helper, please contact a server administrator!`,
                    ephemeral: true
                });
                break;
            case 'startRaid_btn':
                // Directly show the raid request modal
                const raidModal = getRaidRequestModal();
                await interaction.showModal(raidModal);
                break;
            case 'seeRaidTasks_btn':
                // Get the tasks embed and send it ephemerally
                const tasksEmbed = getTasksEmbed();
                await interaction.reply({ embeds: [tasksEmbed], ephemeral: true });
                break;
            case 'howToUse_btn':
                await interaction.reply({
                    content: `**How to Use the Raid Helper Bot:**
1.  **Request a Raid**: Go to the <#${RAID_CHANNEL_ID}> channel and click the "🏹 Help" button (a moderator can use \`!raidhelp\` to make it appear). Fill out the form.
2.  **Raid Coordination**: A dedicated thread will be created for your raid in the raid logs channel. Use it to communicate with helpers.
3.  **Update Status**: In your raid thread, you (the requester) can type \`waiting\` or \`full\` to update the raid's status in the main log.
4.  **Complete Raid**: Once the raid is done, click the "🔒 Close Raid" button in your thread. You'll then be prompted to tag your helpers (e.g., \`all = @user1 @user2\` or \`taskname = @user3\`) and optionally attach a screenshot.
5.  **Check Points**: Use \`!leaderboard\` to see top players or \`!checkrewards\` to see your daily EXP.
                    `,
                    ephemeral: true
                });
                break;
            default:
                // Handle other button interactions if any
                break;
        }
    });
}

// --- Login ---
client.login(process.env.DISCORD_TOKEN);
