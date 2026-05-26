import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { RAID_HELPER_ROLE_ID } from '../../config/constants.js';

export function getRaidTicketMessageUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export async function sendHelperLeftNotification({
  channel,
  guildId,
  raidInfo,
  helperDisplayName,
  activeHelperCount,
  helperCapacity,
}) {
  if (!channel || !raidInfo?.messageId) return;

  const name = String(helperDisplayName || 'A helper').trim();
  const ticketUrl = getRaidTicketMessageUrl(guildId ?? channel.guild?.id, channel.id, raidInfo.messageId);
  const body = ticketUrl
    ? `<@&${RAID_HELPER_ROLE_ID}> **${name}** has left the ticket. Status is ${activeHelperCount}/${helperCapacity}.\n[**VIEW RAID TICKET**](${ticketUrl})`
    : `<@&${RAID_HELPER_ROLE_ID}> **${name}** has left the ticket. Status is ${activeHelperCount}/${helperCapacity}.`;

  await channel.send({
    content: null,
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { roles: [RAID_HELPER_ROLE_ID] },
    components: [
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(body),
      ),
    ],
  }).catch((err) => console.warn('Failed to send helper-left notification:', err));
}
