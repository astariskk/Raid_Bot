import { getSupabase } from './supabaseClient.js';

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

  const supabase = getSupabase();
  const { error } = await supabase.from('raid_ticket_helpers').upsert(
    {
      raid_id: raid,
      helper_id: helper,
      joined_at: joinedAt,
      removed_at: null,
      removed_by: null,
    },
    { onConflict: 'raid_id,helper_id' },
  );
  if (error) throw error;
}

export async function removeRaidHelper(raidId, helperId, removedBy) {
  const raid = normalizeId(raidId);
  const helper = normalizeId(helperId);
  if (!raid || !helper) throw new Error('Raid ID and helper ID are required.');

  const supabase = getSupabase();
  const { error } = await supabase
    .from('raid_ticket_helpers')
    .update({ removed_at: new Date().toISOString(), removed_by: normalizeId(removedBy) || null })
    .eq('raid_id', raid)
    .eq('helper_id', helper);
  if (error) throw error;
}

export async function listRaidHelpers(raidId, { includeRemoved = false } = {}) {
  const raid = normalizeId(raidId);
  if (!raid) return [];

  const supabase = getSupabase();
  let query = supabase
    .from('raid_ticket_helpers')
    .select('raid_id,helper_id,joined_at,removed_at,removed_by')
    .eq('raid_id', raid)
    .order('joined_at', { ascending: true });

  if (!includeRemoved) query = query.is('removed_at', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalizeRow).filter(Boolean);
}

export function calculateSpammingPoints({ joinedAt, endedAt = new Date(), ratePerMinute = 300, cap = 10000 } = {}) {
  const start = new Date(joinedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const minutes = Math.max(1, Math.floor((end - start) / 60000));
  return Math.min(minutes * ratePerMinute, cap);
}
