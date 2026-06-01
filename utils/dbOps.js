import {
  supabaseDelete,
  supabaseRpc,
  supabaseSelect,
  supabaseSelectOne,
  supabaseUpsert,
} from './Supabase/client.js';

const COLLECTION_LEADERBOARD_USERS = 'leaderboard_users';
const COLLECTION_LEADERBOARD_DAILY = 'leaderboard_daily_points';
const COLLECTION_LEADERBOARD_META = 'leaderboard_metadata';
const COLLECTION_RAID_STATES = 'raid_states';

export async function connectDB() {
  return true;
}

export async function closeDB() {
  return true;
}

export async function getLeaderboardData() {
  const [users, metaDoc, daily] = await Promise.all([
    supabaseSelect(COLLECTION_LEADERBOARD_USERS, {
      select: 'user_id,total_exp',
      order: [{ column: 'user_id', direction: 'asc' }],
    }),
    supabaseSelectOne(COLLECTION_LEADERBOARD_META, {
      select: 'last_reset_date,last_backup_message_id',
      filters: [{ column: 'id', op: 'eq', value: 'leaderboard_meta' }],
    }),
    supabaseSelect(COLLECTION_LEADERBOARD_DAILY, {
      select: 'date,user_id,points',
      order: [{ column: 'date', direction: 'asc' }, { column: 'user_id', direction: 'asc' }],
    }),
  ]);

  const leaderboard = {};
  for (const row of users ?? []) {
    leaderboard[row.user_id] = Number(row.total_exp ?? 0);
  }
  leaderboard._lastResetDate = metaDoc?.last_reset_date ?? null;
  leaderboard._dailyPoints = {};
  for (const row of daily ?? []) {
    const date = row.date;
    if (!leaderboard._dailyPoints[date]) leaderboard._dailyPoints[date] = {};
    leaderboard._dailyPoints[date][row.user_id] = Number(row.points ?? 0);
  }
  return leaderboard;
}

export async function setLeaderboardData(leaderboardData) {
  const userDocs = Object.entries(leaderboardData ?? {})
    .filter(([key]) => !key.startsWith('_'))
    .map(([userId, totalExp]) => ({
      user_id: userId,
      total_exp: Number(totalExp ?? 0),
    }));

  const dailyDocs = [];
  const dailyPoints = leaderboardData?._dailyPoints ?? {};
  for (const date of Object.keys(dailyPoints)) {
    for (const userId of Object.keys(dailyPoints[date] ?? {})) {
      dailyDocs.push({
        date,
        user_id: userId,
        points: Number(dailyPoints[date][userId] ?? 0),
      });
    }
  }

  await Promise.all([
    supabaseDelete(COLLECTION_LEADERBOARD_USERS, []),
    supabaseDelete(COLLECTION_LEADERBOARD_DAILY, []),
  ]);

  if (userDocs.length) await supabaseUpsert(COLLECTION_LEADERBOARD_USERS, userDocs, { onConflict: 'user_id' });
  if (dailyDocs.length) await supabaseUpsert(COLLECTION_LEADERBOARD_DAILY, dailyDocs, { onConflict: 'date,user_id' });

  await supabaseUpsert(COLLECTION_LEADERBOARD_META, {
    id: 'leaderboard_meta',
    last_reset_date: leaderboardData?._lastResetDate ?? null,
  }, { onConflict: 'id' });
}

export async function updateUserExp(userId, pointsToAdd) {
  await supabaseRpc('add_exp', {
    p_user_id: String(userId),
    p_points: Number(pointsToAdd),
  });
}

export async function getDailyPointsForRange(userIds, startDate, endDate) {
  const startISO = startDate.toISOString().split('T')[0];
  const endISO = endDate.toISOString().split('T')[0];

  const data = await supabaseSelect(COLLECTION_LEADERBOARD_DAILY, {
    select: 'date,user_id,points',
    filters: [
      { column: 'user_id', op: 'in', value: userIds.map(String) },
      { column: 'date', op: 'gte', value: startISO },
      { column: 'date', op: 'lte', value: endISO },
    ],
  });

  return (data ?? []).map((row) => ({
    date: row.date,
    userId: row.user_id,
    points: Number(row.points ?? 0),
  }));
}

export async function getLastBackupMessageId() {
  const doc = await supabaseSelectOne(COLLECTION_LEADERBOARD_META, {
    select: 'last_backup_message_id',
    filters: [{ column: 'id', op: 'eq', value: 'leaderboard_meta' }],
  });
  return doc?.last_backup_message_id ?? null;
}

export async function setLastBackupMessageId(messageId) {
  await supabaseUpsert(COLLECTION_LEADERBOARD_META, {
    id: 'leaderboard_meta',
    last_backup_message_id: String(messageId),
  }, { onConflict: 'id' });
}

export async function getRaidState(channelId) {
  const data = await supabaseSelectOne(COLLECTION_RAID_STATES, {
    filters: [{ column: 'id', op: 'eq', value: String(channelId) }],
  });

  if (!data) return null;

  const request = data.request ?? {};
  const closing = data.closing ?? {};

  return {
    id: data.id,
    request,
    closing,
    messageId: data.message_id ?? request.messageId ?? request.message_id ?? closing.messageId ?? closing.message_id ?? null,
    originalChannelId: data.original_channel_id ?? request.originalChannelId ?? request.original_channel_id ?? closing.originalChannelId ?? closing.original_channel_id ?? null,
    requesterId: data.requester_id ?? request.requesterId ?? request.requester_id ?? closing.requesterId ?? closing.requester_id ?? null,
    status: data.status ?? null,
    originalName: data.original_name ?? closing.originalName ?? closing.original_name ?? request.originalName ?? request.original_name ?? null,
    task: request.tasks ?? request.task ?? '',
    mapName: request.mapName ?? request.map_name ?? '',
    mapNumber: request.mapNumber ?? request.map_number ?? '',
    server: request.server ?? '',
    description: request.description ?? '',
    lastHelperPingAt: request.lastHelperPingAt ?? request.last_helper_ping_at ?? null,
    lastHelperRoleMentionAt: request.lastHelperRoleMentionAt ?? request.last_helper_role_mention_at ?? request.lastHelperPingAt ?? request.last_helper_ping_at ?? null,
    isAwaitingCompletion: Boolean((data.is_awaiting_completion ?? closing.isAwaitingCompletion ?? closing.is_awaiting_completion) ?? false),
    pendingHelperIds: closing.pendingHelperIds ?? closing.pending_helper_ids ?? null,
    proofImage: closing.proofImage ?? closing.proof_image ?? null,
    partialHelpers: closing.partialHelpers ?? closing.partial_helpers ?? [],
    previousStatus: closing.previousStatus ?? closing.previous_status ?? null,
    awaitingCompletionRequesterId: closing.awaitingCompletionRequesterId ?? closing.awaiting_completion_requester_id ?? null,
    pointsAwarded: closing.pointsAwarded ?? closing.points_awarded ?? null,
    expLairMessageLink: closing.expLairMessageLink ?? closing.exp_lair_message_link ?? null,
  };
}

export async function getRaidStateMinimal(channelId) {
  const data = await supabaseSelectOne(COLLECTION_RAID_STATES, {
    select: 'id,requester_id,status,is_awaiting_completion',
    filters: [{ column: 'id', op: 'eq', value: String(channelId) }],
  });

  if (!data) return null;
  return {
    id: data.id,
    requesterId: data.requester_id ?? null,
    status: data.status ?? null,
    isAwaitingCompletion: Boolean(data.is_awaiting_completion ?? false),
  };
}

export async function createRaidState(channelId, raidDetails) {
  const request = {
    tasks: raidDetails.task ?? '',
    mapName: raidDetails.mapName ?? '',
    mapNumber: raidDetails.mapNumber ?? '',
    server: raidDetails.server ?? '',
    description: raidDetails.description ?? '',
    lastHelperPingAt: raidDetails.lastHelperPingAt ?? null,
    lastHelperRoleMentionAt: raidDetails.lastHelperRoleMentionAt ?? null,
  };

  const closing = {
    pendingHelperIds: raidDetails.pendingHelperIds ?? null,
    proofImage: raidDetails.proofImage ?? null,
    awaitingCompletionRequesterId: raidDetails.awaitingCompletionRequesterId ?? null,
    previousStatus: raidDetails.previousStatus ?? null,
    pointsAwarded: raidDetails.pointsAwarded ?? null,
    expLairMessageLink: raidDetails.expLairMessageLink ?? null,
    partialHelpers: raidDetails.partialHelpers ?? [],
  };

  const now = new Date().toISOString();
  await supabaseUpsert(COLLECTION_RAID_STATES, {
    id: String(channelId),
    requester_id: raidDetails.requesterId ?? null,
    message_id: raidDetails.messageId ?? null,
    original_channel_id: raidDetails.originalChannelId ?? null,
    status: raidDetails.status ?? 'active',
    original_name: raidDetails.originalName ?? null,
    request,
    is_awaiting_completion: Boolean(raidDetails.isAwaitingCompletion ?? false),
    closing,
    created_at: now,
    updated_at: now,
  }, { onConflict: 'id' });
}

export async function updateRaidState(channelId, updates) {
  const existing = await getRaidState(channelId);
  if (!existing) return;

  const request = { ...(existing.request ?? {}) };
  const closing = { ...(existing.closing ?? {}) };
  const columnKeyMap = {
    messageId: 'message_id',
    originalChannelId: 'original_channel_id',
    requesterId: 'requester_id',
    status: 'status',
    originalName: 'original_name',
    isAwaitingCompletion: 'is_awaiting_completion',
  };
  const requestKeys = new Set(['task', 'mapName', 'mapNumber', 'server', 'description', 'lastHelperPingAt', 'lastHelperRoleMentionAt']);
  const closureKeys = new Set([
    'pendingHelperIds',
    'proofImage',
    'previousStatus',
    'awaitingCompletionRequesterId',
    'pointsAwarded',
    'expLairMessageLink',
    'partialHelpers',
  ]);

  const patch = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (Object.prototype.hasOwnProperty.call(columnKeyMap, key)) {
      patch[columnKeyMap[key]] = value;
    } else if (requestKeys.has(key)) {
      request[key === 'task' ? 'tasks' : key] = value;
    } else if (closureKeys.has(key)) {
      closing[key] = value;
    }
  }

  patch.request = request;
  patch.closing = closing;

  await supabaseUpsert(COLLECTION_RAID_STATES, {
    id: String(channelId),
    ...existing,
    ...patch,
  }, { onConflict: 'id' });
}

export async function deleteRaidState(channelId) {
  await supabaseDelete(COLLECTION_RAID_STATES, [{ column: 'id', op: 'eq', value: String(channelId) }]);
}

export async function getCompletedRaidsCount(targetMonthDate) {
  const monthStart = new Date(Date.UTC(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(targetMonthDate.getFullYear(), targetMonthDate.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
  const rows = await supabaseSelect(COLLECTION_RAID_STATES, {
    select: 'id',
    filters: [
      { column: 'status', op: 'eq', value: 'admin_review' },
      { column: 'created_at', op: 'gte', value: monthStart },
      { column: 'created_at', op: 'lte', value: monthEnd },
    ],
  });
  return (rows ?? []).length;
}
