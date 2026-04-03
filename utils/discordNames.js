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

