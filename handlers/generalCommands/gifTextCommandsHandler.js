import { GENERAL_CHANNEL_ID, AQW_CHANNEL_ID } from '../../config/constants.js';
import { getSecretCommandsEmbed, createCustomGifEmbed } from '../../Embeds/generalCommandsEmbeds.js';
import { textGifCommands, gifCommands } from '../../Embeds/customGifEmbeds.js';

const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
const cooldownWarningMessages = new Map();

// --- User IDs to ban from specific commands ---
const BANNED_USERS_FOR_COMMANDS = {
  // 'marbike': ['719443918621638660'],
};

async function deleteCooldownWarning(userId) {
  const messageToDelete = cooldownWarningMessages.get(userId);
  if (!messageToDelete) return;

  try {
    await messageToDelete.delete();
  } catch (err) {
    if (err?.code !== 10008) {
      console.error(`Error deleting cooldown warning message for user ${userId}:`, err);
    }
  } finally {
    cooldownWarningMessages.delete(userId);
  }
}

async function handleCooldown({ message, userId }) {
  const now = Date.now();
  const lastUsed = gifCooldowns.get(userId);
  if (!lastUsed || now - lastUsed >= GIF_COOLDOWN_DURATION) return true;

  const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
  const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

  await deleteCooldownWarning(userId);
  const warningMessage = await message.reply({ content: cooldownMessageContent });
  cooldownWarningMessages.set(userId, warningMessage);

  setTimeout(async () => {
    await deleteCooldownWarning(userId);
  }, GIF_COOLDOWN_DURATION);

  return false;
}

export async function maybeHandleGifTextCommands(message) {
  const commandContent = message.content.toLowerCase();
  const userId = message.author.id;

  if (commandContent === '!secretcommands') {
    const secretCommandsEmbed = getSecretCommandsEmbed(gifCommands, textGifCommands);
    try {
      await message.channel.send({ embeds: [secretCommandsEmbed] });
    } catch (error) {
      console.error('Error sending !secretcommands embed:', error);
      await message.channel.send('Failed to display secret Gif commands. Please try again later.');
    }
    return true;
  }

  if (gifCommands[commandContent]) {
    if (message.channel.id === GENERAL_CHANNEL_ID || message.channel.id === AQW_CHANNEL_ID) return true;

    const ok = await handleCooldown({ message, userId });
    if (!ok) return true;

    gifCooldowns.set(userId, Date.now());
    await deleteCooldownWarning(userId);

    let gifInfo = gifCommands[commandContent];
    if (Array.isArray(gifInfo)) {
      gifInfo = gifInfo[Math.floor(Math.random() * gifInfo.length)];
    }

    const gifEmbed = createCustomGifEmbed(gifInfo);
    try {
      await message.channel.send({ embeds: [gifEmbed] });
    } catch (error) {
      console.error('Error sending custom GIF:', error);
      await message.channel.send('Could not display the beautiful thing.');
    }
    return true;
  }

  if (textGifCommands[commandContent]) {
    if (message.channel.id === GENERAL_CHANNEL_ID || message.channel.id === AQW_CHANNEL_ID) return true;

    const bannedUsers = BANNED_USERS_FOR_COMMANDS[commandContent];
    if (bannedUsers && bannedUsers.includes(userId)) return true;

    const ok = await handleCooldown({ message, userId });
    if (!ok) return true;

    gifCooldowns.set(userId, Date.now());
    await deleteCooldownWarning(userId);

    try {
      await message.channel.send(textGifCommands[commandContent]);
    } catch (error) {
      console.error(`Error sending text GIF command "${commandContent}":`, error);
      await message.channel.send('Could not send the requested GIF message.');
    }
    return true;
  }

  return false;
}
