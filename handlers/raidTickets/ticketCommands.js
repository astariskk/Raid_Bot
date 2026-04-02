import { MessageFlags } from 'discord.js';

import { updateRaidStatus } from '../../activeRaidState.js';
import { generateRaidMapsEmbed, parseRaidTasks } from '../../utils/raidMaps.js';

// --- Main Message Handler ---
export async function handleTicketMessages(message, client, raidInfo) {
  const content = String(message.content ?? '').toLowerCase().trim();

  if (!raidInfo) return;

  // 1. Status Updates
  const statusMap = { '!waiting': 'Waiting', '!full': 'Full', '!ongoing': 'Ongoing' };
  if (statusMap[content]) {
    if (['awaiting_completion', 'completed'].includes(raidInfo.status)) return;
    try {
      await updateRaidStatus(client, message.channel.id, statusMap[content]);
      await message.react('👍');
    } catch (e) {
      console.error(e);
    }
    return;
  }

  // 2. Map Commands
  const mapMatch = content.match(/^!(raidmaps|maps)\s+(\d+)$/);
  if (mapMatch) {
    const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), mapMatch[2]);
    await message.channel.send({ embeds: [embed] });
    return;
  }
}

// --- Interaction Handler for Charts/Maps ---
export async function handleCommandInteractions(interaction, raidInfo) {
  if (interaction.customId === 'raidmapsButton') {
    if (!raidInfo.mapNumber) {
      await interaction.reply({ content: 'No map number set. Use `!raidmaps <number>`.', flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), raidInfo.mapNumber);
    await interaction.reply({ embeds: [embed] });
    return;
  }
}
