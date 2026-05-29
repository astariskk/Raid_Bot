import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { getRaidHelperCapacity } from '../../raidTicketLogic.js';

export function getRaidTicketMessageUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export async function sendHelperLeftNotification({
  channel,
  guildId,
  raidInfo,
  helperDisplayName,
  activeHelperCount = 0,
}) {
  if (!channel || !raidInfo?.messageId) return;

  const ticketUrl = getRaidTicketMessageUrl(guildId ?? channel.guild?.id, channel.id, raidInfo.messageId);
  const name = String(helperDisplayName || 'A helper').trim();
  const helperCapacity = Math.max(1, getRaidHelperCapacity(raidInfo));

  const components = [
    new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${name} has left this raid ticket. Status is ${activeHelperCount}/${helperCapacity}: [**View Raid Ticket**](${ticketUrl})`)),
  ];

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
  }).catch((err) => console.warn('Failed to send helper-left notification:', err));
}
