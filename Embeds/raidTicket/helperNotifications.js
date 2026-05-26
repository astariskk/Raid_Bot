import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

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
  const helperCapacity = raidInfo?.mapNumber?.toString().length >= 4
    ? Math.max(1, parseInt(raidInfo.mapNumber.toString().charAt(0), 10))
    : 4;

  const components = [
    new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${name} has left the raid ticket.`))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel(`View Raid Ticket — ${activeHelperCount}/${helperCapacity}`)
            .setStyle(ButtonStyle.Link)
            .setURL(ticketUrl),
        ),
      ),
  ];

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
  }).catch((err) => console.warn('Failed to send helper-left notification:', err));
}
