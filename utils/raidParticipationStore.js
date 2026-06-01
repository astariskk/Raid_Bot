import { supabaseSelect, supabaseSelectOne, supabaseUpsert } from './Supabase/client.js';

function normalizeId(value) {
  return String(value ?? '').trim();
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    raidId: String(row.raid_id ?? ''),
    helperId: String(row.helper_id ?? ''),
    joinedAt: row.joined_at ?? null,
    removedAt: row.removed_at ?? null,
    removedBy: row.removed_by ?? null,
    accumulatedSeconds: Number(row.accumulated_seconds ?? 0) || 0,
  };
}

function sessionSeconds(joinedAt, endedAt = new Date()) {
  const start = new Date(joinedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / 1000);
}

export function getHelperTotalSeconds(helper, endedAt = new Date()) {
  if (!helper) return 0;
  let total = Number(helper.accumulatedSeconds ?? 0) || 0;
  if (helper.joinedAt && !helper.removedAt) {
    total += sessionSeconds(helper.joinedAt, endedAt);
  }
  return total;
}

export function getHelperTotalMinutes(helper, endedAt = new Date()) {
  return Math.max(0, Math.floor(getHelperTotalSeconds(helper, endedAt) / 60));
}

export async function joinRaidHelper(raidId, helperId, { joinedAt = new Date().toISOString() } = {}) {
  const raid = normalizeId(raidId);
  const helper = normalizeId(helperId);
  if (!raid || !helper) throw new Error('Raid ID and helper ID are required.');

  const existing = await supabaseSelectOne('raid_ticket_helpers', {
    filters: [
      { column: 'raid_id', op: 'eq', value: raid },
      { column: 'helper_id', op: 'eq', value: helper },
    ],
  });

  await supabaseUpsert('raid_ticket_helpers', {
    raid_id: raid,
    helper_id: helper,
    joined_at: joinedAt,
    removed_at: null,
    removed_by: null,
    accumulated_seconds: Number(existing?.accumulated_seconds ?? 0) || 0,
  }, { onConflict: 'raid_id,helper_id' });
}

export async function removeRaidHelper(raidId, helperId, removedBy) {
  const raid = normalizeId(raidId);
  const helper = normalizeId(helperId);
  if (!raid || !helper) throw new Error('Raid ID and helper ID are required.');

  const existing = await supabaseSelectOne('raid_ticket_helpers', {
    filters: [
      { column: 'raid_id', op: 'eq', value: raid },
      { column: 'helper_id', op: 'eq', value: helper },
    ],
  });

  const removedAt = new Date().toISOString();
  let accumulatedSeconds = Number(existing?.accumulated_seconds ?? 0) || 0;
  if (existing?.joined_at && !existing?.removed_at) {
    accumulatedSeconds += sessionSeconds(existing.joined_at, removedAt);
  }

  await supabaseUpsert('raid_ticket_helpers', {
    raid_id: raid,
    helper_id: helper,
    removed_at: removedAt,
    removed_by: normalizeId(removedBy) || null,
    accumulated_seconds: accumulatedSeconds,
    joined_at: existing?.joined_at ?? removedAt,
  }, { onConflict: 'raid_id,helper_id' });
}

export async function listRaidHelpers(raidId, { includeRemoved = false } = {}) {
  const raid = normalizeId(raidId);
  if (!raid) return [];

  const filters = [{ column: 'raid_id', op: 'eq', value: raid }];
  if (!includeRemoved) filters.push({ column: 'removed_at', op: 'is', value: 'null' });

  const data = await supabaseSelect('raid_ticket_helpers', {
    select: 'raid_id,helper_id,joined_at,removed_at,removed_by,accumulated_seconds',
    filters,
    order: [{ column: 'joined_at', direction: 'asc' }],
  });
  return (data ?? []).map(normalizeRow).filter(Boolean);
}

export function calculateSpammingPoints({ joinedAt, endedAt = new Date(), ratePerMinute = 300, cap = 10000, helper = null } = {}) {
  const totalSeconds = helper
    ? getHelperTotalSeconds(helper, endedAt)
    : sessionSeconds(joinedAt, endedAt);

  if (!totalSeconds) return 0;

  const minutes = Math.max(1, Math.floor(totalSeconds / 60));
  return Math.min(minutes * ratePerMinute, cap);
}
