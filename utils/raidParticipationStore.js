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
  };
}

export async function joinRaidHelper(raidId, helperId, { joinedAt = new Date().toISOString() } = {}) {
  const raid = normalizeId(raidId);
  const helper = normalizeId(helperId);
  if (!raid || !helper) throw new Error('Raid ID and helper ID are required.');

  await connectMongo();
  const db = getMongoDb();
  await db.collection('raid_ticket_helpers').updateOne(
    { raid_id: raid, helper_id: helper },
    {
      $set: {
        raid_id: raid,
        helper_id: helper,
        joined_at: joinedAt,
        removed_at: null,
        removed_by: null,
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
  await db.collection('raid_ticket_helpers').updateOne(
    { raid_id: raid, helper_id: helper },
    { $set: { removed_at: new Date().toISOString(), removed_by: normalizeId(removedBy) || null } },
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
    .find(filter, { projection: { _id: 0, raid_id: 1, helper_id: 1, joined_at: 1, removed_at: 1, removed_by: 1 } })
    .sort({ joined_at: 1 })
    .toArray();
  return (data ?? []).map(normalizeRow).filter(Boolean);
}

export function calculateSpammingPoints({ joinedAt, endedAt = new Date(), ratePerMinute = 300, cap = 10000 } = {}) {
  const start = new Date(joinedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const minutes = Math.max(1, Math.floor((end - start) / 60000));
  return Math.min(minutes * ratePerMinute, cap);
}
