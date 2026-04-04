const DISPLAY_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const displayNameCache = new Map(); // userId -> { name, ts }

export function resolveDisplayNameFast({ client, guild, userId }) {
  const cached = displayNameCache.get(userId);
  if (cached && Date.now() - cached.ts < DISPLAY_NAME_CACHE_TTL_MS) return cached.name;

  const member = guild?.members?.cache?.get(userId);
  if (member?.displayName) {
    const name = member.displayName;
    displayNameCache.set(userId, { name, ts: Date.now() });
    return name;
  }

  const user = client?.users?.cache?.get(userId);
  if (user) {
    const name = user.globalName || user.username;
    if (name) {
      displayNameCache.set(userId, { name, ts: Date.now() });
      return name;
    }
  }

  return `<@${userId}>`;
}

export async function resolveDisplayName({ client, guild, userId }) {
  const cached = displayNameCache.get(userId);
  if (cached && Date.now() - cached.ts < DISPLAY_NAME_CACHE_TTL_MS) return cached.name;

  const member = guild?.members?.cache?.get(userId);
  if (member?.displayName) {
    const name = member.displayName;
    displayNameCache.set(userId, { name, ts: Date.now() });
    return name;
  }

  // Try fetching member (guild nickname) first.
  if (guild?.members?.fetch) {
    const fetchedMember = await guild.members.fetch(userId).catch(() => null);
    if (fetchedMember?.displayName) {
      const name = fetchedMember.displayName;
      displayNameCache.set(userId, { name, ts: Date.now() });
      return name;
    }
  }

  // If not in guild anymore, fetch user for global/username.
  if (client?.users?.fetch) {
    const fetchedUser = await client.users.fetch(userId).catch(() => null);
    const name = fetchedUser?.globalName || fetchedUser?.username;
    if (name) {
      displayNameCache.set(userId, { name, ts: Date.now() });
      return name;
    }
  }

  const fallback = resolveDisplayNameFast({ client, guild, userId });
  displayNameCache.set(userId, { name: fallback, ts: Date.now() });
  return fallback;
}
