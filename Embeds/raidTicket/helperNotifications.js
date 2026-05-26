import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

export function getRaidTicketMessageUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export async function sendHelperLeftNotification({
  channel,
  guildId,
  raidInfo,
  helperDisplayName,
}) {
  if (!channel || !raidInfo?.messageId) return;

  const ticketUrl = getRaidTicketMessageUrl(guildId ?? channel.guild?.id, channel.id, raidInfo.messageId);
  const name = String(helperDisplayName || 'A helper').trim();
  const body = ticketUrl
    ? `**${name}** has left the raid ticket. [**View Raid Ticket**](${ticketUrl})`
    : `**${name}** has left the raid ticket.`;

  await channel.send({
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(body),
      ),
    ],
  }).catch((err) => console.warn('Failed to send helper-left notification:', err));
}
