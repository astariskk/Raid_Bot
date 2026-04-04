// utils/dbOps.js (Supabase)

import { getSupabase } from './supabaseClient.js';

export async function connectDB() {
    // Kept for backwards compatibility with existing code paths.
    // Supabase client is created lazily.
    getSupabase();
}

export async function closeDB() {
    // No-op for Supabase.
}

/* -------------------- LEADERBOARD -------------------- */
export async function getLeaderboardData() {
    await connectDB();
    const supabase = getSupabase();

    const [{ data: users, error: usersError }, { data: meta, error: metaError }, { data: daily, error: dailyError }] =
        await Promise.all([
            supabase.from('leaderboard_users').select('user_id,total_exp'),
            supabase.from('leaderboard_metadata').select('last_reset_date,last_backup_message_id').eq('id', 'leaderboard_meta').maybeSingle(),
            supabase.from('leaderboard_daily_points').select('date,user_id,points'),
        ]);

    if (usersError) throw usersError;
    if (metaError) throw metaError;
    if (dailyError) throw dailyError;

    const leaderboard = {};
    for (const row of users ?? []) {
        leaderboard[row.user_id] = Number(row.total_exp ?? 0);
    }

    leaderboard._lastResetDate = meta?.last_reset_date ?? null;
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
    const supabase = getSupabase();

    const userRows = Object.entries(leaderboardData)
        .filter(([key]) => !key.startsWith('_'))
        .map(([userId, totalExp]) => ({
            user_id: userId,
            total_exp: Number(totalExp ?? 0),
        }));

    const dailyRows = [];
    const dailyPoints = leaderboardData?._dailyPoints ?? {};
    for (const date of Object.keys(dailyPoints)) {
        for (const userId of Object.keys(dailyPoints[date] ?? {})) {
            dailyRows.push({
                date,
                user_id: userId,
                points: Number(dailyPoints[date][userId] ?? 0),
            });
        }
    }

    const { error: deleteUsersError } = await supabase.from('leaderboard_users').delete().neq('user_id', '__never__');
    if (deleteUsersError) throw deleteUsersError;
    const { error: deleteDailyError } = await supabase.from('leaderboard_daily_points').delete().neq('user_id', '__never__');
    if (deleteDailyError) throw deleteDailyError;

    if (userRows.length) {
        const { error } = await supabase.from('leaderboard_users').insert(userRows);
        if (error) throw error;
    }
    if (dailyRows.length) {
        const { error } = await supabase.from('leaderboard_daily_points').insert(dailyRows);
        if (error) throw error;
    }

    const { error: metaError } = await supabase
        .from('leaderboard_metadata')
        .upsert({
            id: 'leaderboard_meta',
            last_reset_date: leaderboardData?._lastResetDate ?? null,
        });
    if (metaError) throw metaError;
}

export async function updateUserExp(userId, pointsToAdd) {
    await connectDB();
    const supabase = getSupabase();

    const { error } = await supabase.rpc('add_exp', {
        p_user_id: String(userId),
        p_points: Number(pointsToAdd),
    });
    if (error) throw error;
}

export async function getDailyPointsForRange(userIds, startDate, endDate) {
    await connectDB();
    const supabase = getSupabase();

    const startISO = startDate.toISOString().split('T')[0];
    const endISO = endDate.toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('leaderboard_daily_points')
        .select('date,user_id,points')
        .in('user_id', userIds)
        .gte('date', startISO)
        .lte('date', endISO);

    if (error) throw error;
    return (data ?? []).map((row) => ({
        date: row.date,
        userId: row.user_id,
        points: Number(row.points ?? 0),
    }));
}

export async function getLastBackupMessageId() {
    await connectDB();
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('leaderboard_metadata')
        .select('last_backup_message_id')
        .eq('id', 'leaderboard_meta')
        .maybeSingle();

    if (error) throw error;
    return data?.last_backup_message_id ?? null;
}

export async function setLastBackupMessageId(messageId) {
    await connectDB();
    const supabase = getSupabase();

    const { error } = await supabase
        .from('leaderboard_metadata')
        .upsert({
            id: 'leaderboard_meta',
            last_backup_message_id: String(messageId),
        });
    if (error) throw error;
}

/* -------------------- RAID STATE (TICKETS) -------------------- */
export async function getRaidState(channelId) {
    await connectDB();
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('raid_states')
        .select('id,requester_id,message_id,original_channel_id,status,original_name,is_awaiting_completion,request,closing')
        .eq('id', String(channelId))
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const request = data.request ?? {};
    const closing = data.closing ?? {};

    return {
        id: data.id,
        messageId: data.message_id ?? request.messageId ?? request.message_id ?? closing.messageId ?? closing.message_id ?? null,
        originalChannelId: data.original_channel_id ?? request.originalChannelId ?? request.original_channel_id ?? closing.originalChannelId ?? closing.original_channel_id ?? null,
        requesterId: data.requester_id ?? request.requesterId ?? request.requester_id ?? closing.requesterId ?? closing.requester_id ?? null,
        status: data.status ?? null,
        originalName: data.original_name ?? closing.originalName ?? closing.original_name ?? request.originalName ?? request.original_name ?? null,
        // request (kept as flattened fields for existing code)
        task: request.tasks ?? request.task ?? '',
        mapName: request.mapName ?? request.map_name ?? '',
        mapNumber: request.mapNumber ?? request.map_number ?? '',
        server: request.server ?? '',
        description: request.description ?? '',
        // closing (flattened)
        isAwaitingCompletion: Boolean((data.is_awaiting_completion ?? closing.isAwaitingCompletion ?? closing.is_awaiting_completion) ?? false),
        pendingHelperIds: closing.pendingHelperIds ?? closing.pending_helper_ids ?? null,
        proofImage: closing.proofImage ?? closing.proof_image ?? null,
        partialHelpers: closing.partialHelpers ?? closing.partial_helpers ?? [],
        awaitingCompletionRequesterId: closing.awaitingCompletionRequesterId ?? closing.awaiting_completion_requester_id ?? null,
        pointsAwarded: closing.pointsAwarded ?? closing.points_awarded ?? null,
        expLairMessageLink: closing.expLairMessageLink ?? closing.exp_lair_message_link ?? null,
    };
}

export async function getRaidStateMinimal(channelId) {
    await connectDB();
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('raid_states')
        .select('id,requester_id,status,is_awaiting_completion')
        .eq('id', String(channelId))
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    return {
        id: data.id,
        requesterId: data.requester_id ?? null,
        status: data.status ?? null,
        isAwaitingCompletion: Boolean(data.is_awaiting_completion ?? false),
    };
}

export async function createRaidState(channelId, raidDetails) {
    await connectDB();
    const supabase = getSupabase();

    const request = {
        tasks: raidDetails.task ?? '',
        mapName: raidDetails.mapName ?? '',
        mapNumber: raidDetails.mapNumber ?? '',
        server: raidDetails.server ?? '',
        description: raidDetails.description ?? '',
    };

    const closing = {
        pendingHelperIds: raidDetails.pendingHelperIds ?? null,
        proofImage: raidDetails.proofImage ?? null,
        awaitingCompletionRequesterId: raidDetails.awaitingCompletionRequesterId ?? null,
        pointsAwarded: raidDetails.pointsAwarded ?? null,
        expLairMessageLink: raidDetails.expLairMessageLink ?? null,
        partialHelpers: raidDetails.partialHelpers ?? [],
    };

    const row = {
        id: String(channelId),
        requester_id: raidDetails.requesterId ?? null,
        message_id: raidDetails.messageId ?? null,
        original_channel_id: raidDetails.originalChannelId ?? null,
        status: raidDetails.status ?? 'active',
        original_name: raidDetails.originalName ?? null,
        request,
        is_awaiting_completion: Boolean(raidDetails.isAwaitingCompletion ?? false),
        closing,
    };
    const { error } = await supabase.from('raid_states').insert(row);
    if (error) throw error;
}

export async function updateRaidState(channelId, updates) {
    await connectDB();
    const supabase = getSupabase();

    const columnKeyMap = {
        messageId: 'message_id',
        originalChannelId: 'original_channel_id',
        requesterId: 'requester_id',
        status: 'status',
        originalName: 'original_name',
        isAwaitingCompletion: 'is_awaiting_completion',
    };

    const requestKeys = new Set(['task', 'mapName', 'mapNumber', 'server', 'description']);
    const closureKeys = new Set([
        'pendingHelperIds',
        'proofImage',
        'awaitingCompletionRequesterId',
        'pointsAwarded',
        'expLairMessageLink',
        'partialHelpers',
    ]);

    const columnUpdates = {};
    const requestUpdates = {};
    const closingUpdates = {};

    for (const [key, value] of Object.entries(updates ?? {})) {
        if (Object.prototype.hasOwnProperty.call(columnKeyMap, key)) {
            columnUpdates[columnKeyMap[key]] = value;
            continue;
        }
        if (requestKeys.has(key)) {
            if (key === 'task') requestUpdates.tasks = value;
            else requestUpdates[key] = value;
            continue;
        }
        if (closureKeys.has(key)) {
            closingUpdates[key] = value;
            continue;
        }
        // Ignore unknown keys (old fields like `color` / `size`)
    }

    const needsRequestMerge = Object.keys(requestUpdates).length > 0;
    const needsClosingMerge = Object.keys(closingUpdates).length > 0;

    let request = null;
    let closing = null;
    if (needsRequestMerge || needsClosingMerge) {
        const sel = ['id'];
        if (needsRequestMerge) sel.push('request');
        if (needsClosingMerge) sel.push('closing');

        const { data: existing, error: fetchError } = await supabase
            .from('raid_states')
            .select(sel.join(','))
            .eq('id', String(channelId))
            .maybeSingle();
        if (fetchError) throw fetchError;

        request = existing?.request ?? {};
        closing = existing?.closing ?? {};
    }

    const dbUpdate = { ...columnUpdates };
    if (needsRequestMerge) dbUpdate.request = { ...(request ?? {}), ...requestUpdates };
    if (needsClosingMerge) dbUpdate.closing = { ...(closing ?? {}), ...closingUpdates };

    const { error } = await supabase.from('raid_states').update(dbUpdate).eq('id', String(channelId));
    if (error) throw error;
}

export async function deleteRaidState(channelId) {
    await connectDB();
    const supabase = getSupabase();

    const { error } = await supabase.from('raid_states').delete().eq('id', String(channelId));
    if (error) throw error;
}
