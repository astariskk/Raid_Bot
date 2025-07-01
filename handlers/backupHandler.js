// handlers/backupHandler.js
// This file handles the automatic hourly backup of the leaderboard data
// to a Discord channel and provides a command for administrators to restore the leaderboard.

// Import necessary Discord.js components for embeds.
import { EmbedBuilder } from 'discord.js';
// Import Node.js 'fs/promises' for file operations.
import fs from 'node:fs/promises';
// Import file operations utilities for reading and writing leaderboard data.
import { readLeaderboard, writeLeaderboard } from '../utils/fileOps.js';
// Import constants for file paths, role IDs, and channel IDs.
import {
    LEADERBOARD_FILE,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
    RAID_MANAGER_ROLE_ID
} from '../config/constants.js';

// --- Helper Function: isAdmin ---
/**
 * Checks if the message author has the designated MODERATOR_ROLE_ID, OFFICER_ROLE_ID, or RAID_MANAGER_ROLE_ID.
 * This function is used to gate administrative commands.
 * @param {import('discord.js').Message} message The Discord message object.
 * @returns {boolean} True if the author has any of the required roles, false otherwise.
 */
function isAdmin(message) {
    // Ensure message.member exists (i.e., it's a guild message)
    if (!message.member) return false;

    return (
        message.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        message.member.roles.cache.has(OFFICER_ROLE_ID) ||
        message.member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

// --- Backup Function ---
/**
 * Reads the leaderboard file, optionally unsends the previous backup message,
 * and sends a new backup as an attachment to the designated channel.
 * This function is now called externally (e.g., from expLairHandler or !lbackup command).
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export async function sendLeaderboardBackup(client) { // Exported for external use
    try {
        // 1. Ensure the RAID_MANAGEMENT_CHANNEL_ID is configured and valid.
        if (!RAID_MANAGEMENT_CHANNEL_ID) {
            console.error('RAID_MANAGEMENT_CHANNEL_ID is not defined in constants.js. Cannot send leaderboard backup.');
            return;
        }

        const channel = await client.channels.fetch(RAID_MANAGEMENT_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.error(`RAID_MANAGEMENT_CHANNEL_ID (${RAID_MANAGEMENT_CHANNEL_ID}) is not a valid text channel or could not be fetched.`);
            return;
        }

        // 2. Find and delete the bot's previous backup message.
        // We'll search the last 100 messages for a message sent by the bot with the backup embed title.
        const messages = await channel.messages.fetch({ limit: 100 });
        const previousBackupMessage = messages.find(
            (msg) =>
                msg.author.id === client.user.id &&
                msg.embeds.some(embed => embed.title === '💾 Leaderboard Backup Created')
        );

        if (previousBackupMessage) {
            console.log('Deleting previous leaderboard backup message...');
            await previousBackupMessage.delete();
        }

        // 3. Read the leaderboard file content.
        const leaderboardFileContent = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        const fileBuffer = Buffer.from(leaderboardFileContent, 'utf8');

        // 4. Create a new embed for the backup message.
        const backupEmbed = new EmbedBuilder()
            .setColor(0x00FF00) // Green color for success/backup.
            .setTitle('💾 Leaderboard Backup Created')
            .setDescription('Here is the latest `leaderboard.json` file for backup purposes. This message will be replaced with the next backup.\n`!restorelb` command can be used to restore the leaderboard from this file. \n`lbackup` command can be used to manually trigger a backup.')
            .setTimestamp()
            .setFooter({ text: 'Raid Helper Bot | Automatic Backup Triggered' }); // Updated footer text

        // 5. Send the new file as an attachment.
        await channel.send({
            embeds: [backupEmbed],
            files: [{
                attachment: fileBuffer,
                name: 'leaderboard.json' // Name of the file when downloaded.
            }]
        });
        console.log(`Leaderboard backup sent to channel ${channel.name} (${channel.id}).`);

    } catch (error) {
        console.error('Error sending leaderboard backup:', error);
        // We can send an error message to a logging channel here if needed.
    }
}

// --- Setup Function for Backup Handlers ---
/**
 * Sets up event listeners for leaderboard restore functionalities and manual backup command.
 * The automatic backup trigger is now handled by other modules (e.g., expLairHandler).
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export function setupBackupHandlers(client) {
    // Removed setInterval and client.on('ready') auto-triggers.
    // The sendLeaderboardBackup function is now called by other handlers when data changes.

    // --- Message Create Listener (for !restorelb and !lbackup commands) ---
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return; // Ignore messages from bots.

        // --- Handle Forced Backup Command (`!lbackup`) ---
        if (message.content.toLowerCase() === '!lbackup') {
            // Check if the user has admin permissions.
            if (!isAdmin(message)) {
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            await message.reply('Generating and uploading a new leaderboard backup now...');
            await sendLeaderboardBackup(client); // Trigger the backup function immediately.
            return; // Exit after handling the command.
        }

        // --- Handle Restore Leaderboard Command (`!restorelb`) ---
        if (message.content.toLowerCase().startsWith('!restorelb')) {
            // Check if the user has admin permissions.
            if (!isAdmin(message)) {
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            // Ensure the command is used in a guild (server).
            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            // Check if a file attachment is provided.
            if (message.attachments.size === 0) {
                return message.reply('Usage: `!restorelb` (attach your `leaderboard.json` file).');
            }

            const attachment = message.attachments.first();

            // Validate the attachment: check filename and content type.
            if (attachment.name !== 'leaderboard.json' || !attachment.contentType.includes('json')) {
                return message.reply('Please attach a valid `leaderboard.json` file.');
            }

            try {
                // Fetch the content of the attached file.
                const response = await fetch(attachment.url);
                const fileContent = await response.text();

                // Attempt to parse the JSON content.
                const newLeaderboardData = JSON.parse(fileContent);

                // Basic validation: Check for expected keys.
                if (typeof newLeaderboardData !== 'object' || newLeaderboardData === null ||
                    (!newLeaderboardData.hasOwnProperty('_lastResetDate') && !newLeaderboardData.hasOwnProperty('_dailyPoints'))) {
                    return message.reply('The attached JSON file does not appear to be a valid leaderboard file.');
                }

                // Write the new data to the leaderboard file, effectively restoring it.
                await writeLeaderboard(newLeaderboardData);

                await message.reply('Leaderboard successfully restored from the attached file! Please wait for the changes to take effect.');
                console.log(`Leaderboard restored by ${message.author.tag} from attached file.`);

            } catch (error) {
                console.error('Error restoring leaderboard from file:', error);
                if (error instanceof SyntaxError) {
                    await message.reply('Failed to parse the attached file. Please ensure it is valid JSON.');
                } else {
                    await message.reply('Failed to restore leaderboard. Please check the file and try again.');
                }
            }
        }
    });
}
