import { getSupabase } from './supabaseClient.js';
import { loadRaidTasksCache } from '../config/constants/tasks.js';

function normalizeTaskKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

function normalizeLooseText(value) {
  return String(value ?? '').trim();
}

function normalizeStringList(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeLooseText).filter(Boolean))];
  }

  const raw = String(value ?? '').trim();
  if (!raw) return [];

  return [...new Set(raw.split(/\s*[,|]\s*/).map(normalizeLooseText).filter(Boolean))];
}

function toTaskRow(input = {}, { partial = false } = {}) {
  const displayName = normalizeLooseText(input.displayName ?? input.display_name ?? input.name);
  const key = normalizeTaskKey(input.key ?? displayName);
  if (!key) throw new Error('Task display name is required.');

  const row = { key };

  if (!partial || input.displayName !== undefined || input.display_name !== undefined) {
    row.display_name = displayName || key;
  }
  if (!partial || input.points !== undefined) {
    const points = Number(input.points ?? 0);
    if (!Number.isFinite(points) || points < 0) throw new Error('Points must be a non-negative number.');
    row.points = Math.floor(points);
  }
  if (!partial || input.category !== undefined) {
    const category = normalizeTaskKey(input.category || 'generic') || 'generic';
    row.category = category;
  }
  if (!partial || input.active !== undefined || input.available !== undefined) {
    row.active = Boolean(input.active ?? input.available ?? true);
  }
  if (!partial || input.description !== undefined || input.taskDescription !== undefined) {
    row.description = normalizeLooseText(input.description ?? input.taskDescription ?? '') || null;
  }
  if (!partial || input.mapNames !== undefined || input.mapName !== undefined || input.map_names !== undefined) {
    row.map_names = normalizeStringList(input.mapNames ?? input.mapName ?? input.map_names);
  }
  if (!partial || input.aliases !== undefined || input.taskAlias !== undefined) {
    row.aliases = normalizeStringList(input.aliases ?? input.taskAlias);
  }
  if (!partial || input.sortOrder !== undefined || input.sort_order !== undefined) {
    const sortOrder = Number(input.sortOrder ?? input.sort_order ?? 0);
    if (!Number.isFinite(sortOrder)) throw new Error('Sort order must be a number.');
    row.sort_order = Math.floor(sortOrder);
  }

  return row;
}

export function parseBooleanInput(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', 'on', '1', 'available', 'active', 'enabled'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'off', '0', 'unavailable', 'inactive', 'disabled'].includes(normalized)) return false;
  throw new Error('Available/active must be true or false.');
}

export async function getRaidTask(key) {
  const taskKey = normalizeTaskKey(key);
  if (!taskKey) throw new Error('Task key/name is required.');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raid_tasks')
    .select('key,display_name,points,category,active,description,map_names,aliases,sort_order')
    .eq('key', taskKey)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getRaidTaskByDisplayName(displayName) {
  const name = normalizeLooseText(displayName);
  if (!name) throw new Error('Task display name is required.');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raid_tasks')
    .select('key,display_name,points,category,active,description,map_names,aliases,sort_order')
    .ilike('display_name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function resolveRaidTask(identifier) {
  const value = normalizeLooseText(identifier);
  if (!value) throw new Error('Task key or display name is required.');

  const byKey = await getRaidTask(value).catch(() => null);
  if (byKey) return byKey;

  return getRaidTaskByDisplayName(value);
}

export async function listRaidTasks({ includeInactive = true } = {}) {
  const supabase = getSupabase();
  let query = supabase
    .from('raid_tasks')
    .select('key,display_name,points,category,active,description,map_names,aliases,sort_order')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('display_name', { ascending: true });

  if (!includeInactive) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function upsertRaidTask(input = {}) {
  const existing = await resolveRaidTask(input.key ?? input.displayName ?? input.display_name ?? input.name).catch(() => null);
  const row = toTaskRow({ ...input, key: existing?.key }, { partial: false });
  const supabase = getSupabase();

  const { error } = await supabase.from('raid_tasks').upsert(row, { onConflict: 'key' });
  if (error) throw error;

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after upsert:', error?.message || error);
  });

  return getRaidTask(row.key);
}

export async function updateRaidTask(identifier, patch = {}) {
  const existing = await resolveRaidTask(identifier);
  if (!existing) throw new Error(`Task \`${identifier}\` does not exist yet. Use /addtask first.`);

  const row = toTaskRow({ ...patch, key: existing.key, displayName: existing.display_name }, { partial: true });
  delete row.key;

  if (!Object.keys(row).length) return existing;

  const supabase = getSupabase();
  const { error } = await supabase.from('raid_tasks').update(row).eq('key', existing.key);
  if (error) throw error;

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after update:', error?.message || error);
  });

  return getRaidTask(existing.key);
}

export function formatRaidTaskSummary(task) {
  const maps = Array.isArray(task?.map_names) && task.map_names.length ? task.map_names.join(', ') : 'none';
  const aliases = Array.isArray(task?.aliases) && task.aliases.length ? task.aliases.join(', ') : 'none';
  const description = task?.description ? `\nDescription: ${task.description}` : '';

  return [
    `Task: ${task.display_name} (${task.active ? 'available' : 'unavailable'})`,
    `Points: ${task.points}`,
    `Category: ${task.category}`,
    `Maps: ${maps}`,
    `Aliases: ${aliases}${description}`,
  ].join('\n');
}
