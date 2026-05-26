import { updateRaid } from '../../activeRaidState.js';
import { HELPER_PING_COOLDOWN_MS } from '../../Embeds/raidTicket/constants.js';

export function getLastHelperRoleMentionAt(raidInfo) {
  return (
    raidInfo?.lastHelperRoleMentionAt
    ?? raidInfo?.lastHelperPingAt
    ?? null
  );
}

export function getHelperRoleMentionCooldownRemainingMs(raidInfo) {
  const lastMention = getLastHelperRoleMentionAt(raidInfo);
  if (!lastMention) return 0;
  const elapsed = Date.now() - new Date(lastMention).getTime();
  return Math.max(0, HELPER_PING_COOLDOWN_MS - elapsed);
}

export async function recordHelperRoleMention(channelId, at = new Date()) {
  const iso = at instanceof Date ? at.toISOString() : String(at);
  await updateRaid(channelId, {
    lastHelperRoleMentionAt: iso,
    lastHelperPingAt: iso,
  });
  return iso;
}
