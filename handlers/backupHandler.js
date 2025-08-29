// handlers/backupHandler.js

import { AttachmentBuilder } from 'discord.js';
import { LB_BACKUP_CHANNEL_ID } from '../config/constants.js';
import { getCachedLeaderboard } from './leaderboardCore.js';
// Import the new DB functions you will add to dbOps.js
import { getLastBackupMessageId, setLastBackupMessageId } from '../utils/dbOps.js';

/**
 * Sends a backup of the current leaderboard data, deleting the previous one.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @returns {Promise<void>}
 */
export async function sendLeaderboardBackup(client) {
    try {
        const raidManagementChannel = await client.channels.fetch(LB_BACKUP_CHANNEL_ID);

        // Ensure channel is valid before proceeding
        if (!raidManagementChannel || !raidManagementChannel.isTextBased()) {
            console.warn(`LB_BACKUP_CHANNEL_ID (${LB_BACKUP_CHANNEL_ID}) is not a text channel or could not be fetched. Cannot send backup.`);
            return;
        }

        // 1. Fetch and delete the old backup message
        const lastBackupMessageId = await getLastBackupMessageId();
        if (lastBackupMessageId) {
            try {
                const oldMessage = await raidManagementChannel.messages.fetch(lastBackupMessageId);
                await oldMessage.delete();
                console.log(`Deleted previous backup message with ID: ${lastBackupMessageId}`);
            } catch (error) {
                // It's common for the message to be missing (e.g., manually deleted), so we just log a warning.
                if (error.code === 10008) { // "Unknown Message" error code
                    console.warn(`Could not delete previous backup message (ID: ${lastBackupMessageId}) because it was not found. It was likely already deleted.`);
                } else {
                    console.error('Error deleting previous backup message:', error);
                }
            }
        }

        // 2. Prepare and send the new backup
        const leaderboardData = await getCachedLeaderboard();
        const backupFileName = `leaderboard_backup_${new Date().toISOString().split('T')[0]}.json`;
        const backupBuffer = Buffer.from(JSON.stringify(leaderboardData, null, 2));
        const attachment = new AttachmentBuilder(backupBuffer, { name: backupFileName });

        const newBackupMessage = await raidManagementChannel.send({
            content: '📊 Daily Leaderboard Backup:',
            files: [attachment],
        });

        // 3. Save the new message ID to the database
        await setLastBackupMessageId(newBackupMessage.id);

    } catch (error) {
        console.error('Error sending leaderboard backup:', error);
    }
}

/**
 * Sets up the backup handler. Currently, this function just exports sendLeaderboardBackup.
 * It's kept for consistency with other handler setup functions.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export function setupBackupHandlers(client) {
}
