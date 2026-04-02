// handlers/slashCommands/utils.js
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';

export function isAdmin(interaction) {
  if (!interaction.member) {
    console.warn('isAdmin called without a member object (e.g., DM).');
    return false;
  }
  return (
    interaction.member.roles.cache.has(MODERATOR_ROLE_ID) ||
    interaction.member.roles.cache.has(OFFICER_ROLE_ID) ||
    interaction.member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

export function replyNoPermission(interaction) {
  return interaction.reply({
    content: 'You do not have permission to use this command.',
    flags: MessageFlags.Ephemeral,
  });
}

export function createXpEmbed(action, amount, userIds) {
  const isPositive = action === 'add';
  const xpString = isPositive ? `added ${amount} EXP to` : `removed ${amount} EXP from`;
  const title = isPositive ? 'EXP Added' : 'EXP Removed';
  const color = isPositive ? EMBED_COLOR : 0xff0000;

  const userMentions = userIds.map((id) => `<@${id}>`).join(', ');

  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(`${xpString} \n${userMentions}`);
}

