import { connectMongo, getMongoDb } from './mongoClient.js';

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

/** Total seconds in ticket across all join/leave sessions (active session included). */
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

  await connectMongo();
  const db = getMongoDb();
  const existing = await db.collection('raid_ticket_helpers').findOne(
    { raid_id: raid, helper_id: helper },
    { projection: { accumulated_seconds: 1 } },
  );
  const accumulatedSeconds = Number(existing?.accumulated_seconds ?? 0) || 0;

  await db.collection('raid_ticket_helpers').updateOne(
    { raid_id: raid, helper_id: helper },
    {
      $set: {
        raid_id: raid,
        helper_id: helper,
        joined_at: joinedAt,
        removed_at: null,
        removed_by: null,
        accumulated_seconds: accumulatedSeconds,
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
}

export async function removeRaidHelper(raidId, helperId, removedBy) {
  const raid = normalizeId(raidId);
  const helper = normalizeId(helperId);
  if (!raid || !helper) throw new Error('Raid ID and helper ID are required.');

  await connectMongo();
  const db = getMongoDb();
  const existing = await db.collection('raid_ticket_helpers').findOne(
    { raid_id: raid, helper_id: helper },
    { projection: { joined_at: 1, removed_at: 1, accumulated_seconds: 1 } },
  );

  const removedAt = new Date().toISOString();
  let accumulatedSeconds = Number(existing?.accumulated_seconds ?? 0) || 0;
  if (existing?.joined_at && !existing?.removed_at) {
    accumulatedSeconds += sessionSeconds(existing.joined_at, removedAt);
  }

  await db.collection('raid_ticket_helpers').updateOne(
    { raid_id: raid, helper_id: helper },
    {
      $set: {
        removed_at: removedAt,
        removed_by: normalizeId(removedBy) || null,
        accumulated_seconds: accumulatedSeconds,
      },
    },
  );
}

export async function listRaidHelpers(raidId, { includeRemoved = false } = {}) {
  const raid = normalizeId(raidId);
  if (!raid) return [];

  await connectMongo();
  const db = getMongoDb();
  const filter = { raid_id: raid };
  if (!includeRemoved) filter.removed_at = null;
  const data = await db.collection('raid_ticket_helpers')
    .find(filter, { projection: { _id: 0, raid_id: 1, helper_id: 1, joined_at: 1, removed_at: 1, removed_by: 1, accumulated_seconds: 1 } })
    .sort({ joined_at: 1 })
    .toArray();
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
