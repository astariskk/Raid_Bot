import { RAID_HELPER_ROLE_ID, RAID_STATUS } from '../../config/constants.js';
import { RAID_TICKET_HELP_TEXT } from './constants.js';
import { buildMainTicketMessagePayload } from './mainTicket.js';

export function buildAllowedMentions(raidInfo) {
  return {
    roles: [RAID_HELPER_ROLE_ID],
    users: raidInfo?.requesterId ? [String(raidInfo.requesterId)] : [],
  };
}

/** Plain text message — not a V2 component or embed. */
export function buildMentionMessage(raidInfo) {
  return {
    content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from <@${raidInfo?.requesterId}>`,
    allowedMentions: buildAllowedMentions(raidInfo),
  };
}

export function buildHelpMessage() {
  return {
    content: RAID_TICKET_HELP_TEXT,
  };
}

export function buildRaidRequestMessagePayload({ requester, raidInfo, helpers = [], isClosing }) {
  const visibleHelpers = helpers;
  const closing = isClosing ?? Boolean(
    raidInfo?.isAwaitingCompletion || raidInfo?.status === RAID_STATUS.AWAITING_COMPLETION,
  );
  return {
    ...buildMainTicketMessagePayload({ requester, raidInfo, helpers: visibleHelpers, isClosing: closing }),
    allowedMentions: buildAllowedMentions(raidInfo),
  };
}

export async function sendRaidTicketMessages(channel, { requester, raidInfo, helpers = [] }) {
  const mentionedAt = new Date().toISOString();
  await channel.send(buildMentionMessage(raidInfo));
  const mainMessage = await channel.send(buildRaidRequestMessagePayload({ requester, raidInfo, helpers }));
  await channel.send(buildHelpMessage());
  await mainMessage.pin().catch(() => {});
  return {
    messageId: mainMessage.id,
    lastHelperRoleMentionAt: mentionedAt,
  };
}
