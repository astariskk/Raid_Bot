// utils/dbOps.js (MongoDB Atlas)

import { connectMongo, getMongoDb, closeMongo } from './mongoClient.js';

const COLLECTION_LEADERBOARD_USERS = 'leaderboard_users';
const COLLECTION_LEADERBOARD_DAILY = 'leaderboard_daily_points';
const COLLECTION_LEADERBOARD_META = 'leaderboard_meta';
const COLLECTION_RAID_STATES = 'raid_states';

export async function connectDB() {
    return connectMongo();
}

export async function closeDB() {
    return closeMongo();
}

/* -------------------- LEADERBOARD -------------------- */
export async function getLeaderboardData() {
    await connectDB();
    const db = getMongoDb();

    const [users, metaDoc, daily] = await Promise.all([
        db.collection(COLLECTION_LEADERBOARD_USERS).find({}, { projection: { _id: 0, user_id: 1, total_exp: 1 } }).toArray(),
        db.collection(COLLECTION_LEADERBOARD_META).findOne({ _id: 'leaderboard_meta' }),
        db.collection(COLLECTION_LEADERBOARD_DAILY).find({}, { projection: { _id: 0, date: 1, user_id: 1, points: 1 } }).toArray(),
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
    await connectDB();
    const db = getMongoDb();

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

    await db.collection(COLLECTION_LEADERBOARD_USERS).deleteMany({});
    await db.collection(COLLECTION_LEADERBOARD_DAILY).deleteMany({});

    if (userDocs.length) await db.collection(COLLECTION_LEADERBOARD_USERS).insertMany(userDocs);
    if (dailyDocs.length) await db.collection(COLLECTION_LEADERBOARD_DAILY).insertMany(dailyDocs);

    await db.collection(COLLECTION_LEADERBOARD_META).updateOne(
        { _id: 'leaderboard_meta' },
        { $set: { last_reset_date: leaderboardData?._lastResetDate ?? null } },
        { upsert: true }
    );
}

export async function updateUserExp(userId, pointsToAdd) {
    await connectDB();
    const db = getMongoDb();
    const user = String(userId);
    const points = Number(pointsToAdd);
    const today = new Date().toISOString().split('T')[0];

    await Promise.all([
        db.collection(COLLECTION_LEADERBOARD_USERS).updateOne(
            { user_id: user },
            { $inc: { total_exp: points } },
            { upsert: true }
        ),
        db.collection(COLLECTION_LEADERBOARD_DAILY).updateOne(
            { date: today, user_id: user },
            { $inc: { points }, $setOnInsert: { date: today, user_id: user } },
            { upsert: true }
        ),
    ]);
}

export async function getDailyPointsForRange(userIds, startDate, endDate) {
    await connectDB();
    const db = getMongoDb();

    const startISO = startDate.toISOString().split('T')[0];
    const endISO = endDate.toISOString().split('T')[0];

    const data = await db.collection(COLLECTION_LEADERBOARD_DAILY)
        .find({
            user_id: { $in: userIds.map(String) },
            date: { $gte: startISO, $lte: endISO },
        }, { projection: { _id: 0, date: 1, user_id: 1, points: 1 } })
        .toArray();

    return data.map((row) => ({
        date: row.date,
        userId: row.user_id,
        points: Number(row.points ?? 0),
    }));
}

export async function getLastBackupMessageId() {
    await connectDB();
    const db = getMongoDb();

    const doc = await db.collection(COLLECTION_LEADERBOARD_META).findOne(
        { _id: 'leaderboard_meta' },
        { projection: { _id: 0, last_backup_message_id: 1 } }
    );

    return doc?.last_backup_message_id ?? null;
}

export async function setLastBackupMessageId(messageId) {
    await connectDB();
    const db = getMongoDb();

    await db.collection(COLLECTION_LEADERBOARD_META).updateOne(
        { _id: 'leaderboard_meta' },
        { $set: { last_backup_message_id: String(messageId) } },
        { upsert: true }
    );
}

/* -------------------- RAID STATE (TICKETS) -------------------- */
export async function getRaidState(channelId) {
    await connectDB();
    const db = getMongoDb();

    const data = await db.collection(COLLECTION_RAID_STATES).findOne(
        { _id: String(channelId) },
        { projection: { _id: 1, requester_id: 1, message_id: 1, original_channel_id: 1, status: 1, original_name: 1, is_awaiting_completion: 1, request: 1, closing: 1 } }
    );

    if (!data) return null;

    const request = data.request ?? {};
    const closing = data.closing ?? {};

    return {
        id: data._id,
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
    await connectDB();
    const db = getMongoDb();

    const data = await db.collection(COLLECTION_RAID_STATES).findOne(
        { _id: String(channelId) },
        { projection: { _id: 1, requester_id: 1, status: 1, is_awaiting_completion: 1 } }
    );

    if (!data) return null;

    return {
        id: data._id,
        requesterId: data.requester_id ?? null,
        status: data.status ?? null,
        isAwaitingCompletion: Boolean(data.is_awaiting_completion ?? false),
    };
}

export async function createRaidState(channelId, raidDetails) {
    await connectDB();
    const db = getMongoDb();

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

    const now = new Date();
    const doc = {
        _id: String(channelId),
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
    };

    await db.collection(COLLECTION_RAID_STATES).insertOne(doc);
}

export async function updateRaidState(channelId, updates) {
    await connectDB();
    const db = getMongoDb();

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

    const set = { updated_at: new Date() };

    for (const [key, value] of Object.entries(updates ?? {})) {
        if (Object.prototype.hasOwnProperty.call(columnKeyMap, key)) {
            set[columnKeyMap[key]] = value;
        } else if (requestKeys.has(key)) {
            set[`request.${key === 'task' ? 'tasks' : key}`] = value;
        } else if (closureKeys.has(key)) {
            set[`closing.${key}`] = value;
        }
    }

    if (Object.keys(set).length > 1) {
        await db.collection(COLLECTION_RAID_STATES).updateOne(
            { _id: String(channelId) },
            { $set: set }
        );
    }
}

export async function deleteRaidState(channelId) {
  await connectDB();
  const db = getMongoDb();

  await db.collection(COLLECTION_RAID_STATES).deleteOne({ _id: String(channelId) });
}

export async function getCompletedRaidsCount(targetMonthDate) {
  await connectDB();
  const db = getMongoDb();

  const monthStart = new Date(Date.UTC(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), 1));
  const monthEnd = new Date(Date.UTC(targetMonthDate.getFullYear(), targetMonthDate.getMonth() + 1, 0, 23, 59, 59, 999));

  return db.collection(COLLECTION_RAID_STATES).countDocuments({
    status: 'admin_review',
    created_at: { $gte: monthStart, $lte: monthEnd },
  });
}
