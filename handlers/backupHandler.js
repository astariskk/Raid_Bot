// handlers/backupHandler.js

import { AttachmentBuilder } from 'discord.js';
import { RAID_MANAGEMENT_CHANNEL_ID } from '../config/constants.js';
import { getCachedLeaderboard } from './leaderboardCore.js'; 

/**
 * Sends a backup of the current leaderboard data to the designated raid management channel.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @returns {Promise<void>}
 */
export async function sendLeaderboardBackup(client) {
    try {
        const leaderboardData = await getCachedLeaderboard(); 
        const backupFileName = `leaderboard_backup_${new Date().toISOString().split('T')[0]}.json`;
        const backupBuffer = Buffer.from(JSON.stringify(leaderboardData, null, 2));

        const attachment = new AttachmentBuilder(backupBuffer, { name: backupFileName });

        const raidManagementChannel = await client.channels.fetch(RAID_MANAGEMENT_CHANNEL_ID);

        if (raidManagementChannel && raidManagementChannel.isTextBased()) {
            await raidManagementChannel.send({
                content: '📊 Daily Leaderboard Backup:',
                files: [attachment],
            });
            console.log(`Leaderboard backup sent to channel ${RAID_MANAGEMENT_CHANNEL_ID}`);
        } else {
            console.warn(`RAID_MANAGEMENT_CHANNEL_ID (${RAID_MANAGEMENT_CHANNEL_ID}) is not a text channel or could not be fetched. Cannot send backup.`);
        }
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
