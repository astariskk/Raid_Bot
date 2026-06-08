import { AttachmentBuilder } from 'discord.js';
import { LB_BACKUP_CHANNEL_ID } from '../../config/constants.js';
let getCachedLeaderboard = async () => ({});
try {
  ({ getCachedLeaderboard } = await import('../leaderboard/core.js'));
} catch {
  // leaderboard handler modules may be missing in trimmed repo
}

import { getLastBackupMessageId, setLastBackupMessageId } from '../../utils/dbOps.js';

function getLeaderboardBackupChannelId() {
  return String(process.env.BACKUP_LEADERBOARD_CHANNEL_ID || LB_BACKUP_CHANNEL_ID || '').trim();
}

export async function sendLeaderboardBackup(client) {
  try {
    const backupChannelId = getLeaderboardBackupChannelId();
    if (!backupChannelId) {
      console.warn('No leaderboard backup channel configured. Set BACKUP_LEADERBOARD_CHANNEL_ID or LB_BACKUP_CHANNEL_ID.');
      return;
    }

    const backupChannel = await client.channels.fetch(backupChannelId);
    if (!backupChannel || !backupChannel.isTextBased()) {
      console.warn(`Leaderboard backup channel (${backupChannelId}) is not a text channel or could not be fetched. Cannot send backup.`);
      return;
    }

    const lastBackupMessageId = await getLastBackupMessageId();
    if (lastBackupMessageId) {
      try {
        const oldMessage = await backupChannel.messages.fetch(lastBackupMessageId);
        await oldMessage.delete();
        console.log(`Deleted previous backup message with ID: ${lastBackupMessageId}`);
      } catch (error) {
        if (error?.code === 10008) {
          console.warn(`Could not delete previous backup message (ID: ${lastBackupMessageId}) because it was not found.`);
        } else {
          console.error('Error deleting previous backup message:', error);
        }
      }
    }

    const leaderboardData = await getCachedLeaderboard();
    const backupFileName = `leaderboard_backup_${new Date().toISOString().split('T')[0]}.json`;
    const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(leaderboardData, null, 2)), {
      name: backupFileName,
    });

    const newBackupMessage = await backupChannel.send({
      content: 'Leaderboard Backup:',
      files: [attachment],
    });

    await setLastBackupMessageId(newBackupMessage.id);
  } catch (error) {
    console.error('Error sending leaderboard backup:', error);
  }
}

export function setupBackupHandlers(client) {}
