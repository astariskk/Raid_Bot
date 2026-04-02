const SESSION_TTL_MS = 10 * 60 * 1000;

const sessions = new Map();

function createSessionId(userId) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ph_${userId}_${ts}_${rand}`.slice(0, 95);
}

export function createPartialHelperSession({ userId, guildId, channelId }) {
  const sessionId = createSessionId(userId);
  const now = Date.now();

  sessions.set(sessionId, {
    sessionId,
    userId,
    guildId,
    channelId,
    parentMessageId: null,
    step: 'entry',
    selectedEntryHelperId: null,
    selectedTasks: [],
    selectedHelperIds: [],
    createdAtMs: now,
    updatedAtMs: now,
  });

  return sessionId;
}

export function getPartialHelperSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.updatedAtMs > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function updatePartialHelperSession(sessionId, patch) {
  const current = getPartialHelperSession(sessionId);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
    updatedAtMs: Date.now(),
  };
  sessions.set(sessionId, next);
  return next;
}

export function consumePartialHelperSession(sessionId) {
  const session = getPartialHelperSession(sessionId);
  sessions.delete(sessionId);
  return session;
}
