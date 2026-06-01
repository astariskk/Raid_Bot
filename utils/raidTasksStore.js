import { loadRaidTasksCache } from '../config/constants/tasks.js';
import {
  supabaseDelete,
  supabaseSelect,
  supabaseSelectOne,
  supabaseUpsert,
  supabaseUpdate,
} from './Supabase/client.js';

function normalizeTaskKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

function formatCategoryLabel(key) {
  return String(key ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
    row.category = normalizeTaskKey(input.category || 'generic') || 'generic';
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
  return supabaseSelectOne('raid_tasks', { filters: [{ column: 'key', op: 'eq', value: taskKey }] });
}

export async function getRaidTaskByDisplayName(displayName) {
  const name = normalizeLooseText(displayName);
  if (!name) throw new Error('Task display name is required.');
  const tasks = await supabaseSelect('raid_tasks', { select: '*' });
  return (tasks ?? []).find((task) => String(task.display_name ?? '').trim().toLowerCase() === name.toLowerCase()) ?? null;
}

export async function resolveRaidTask(identifier) {
  const value = normalizeLooseText(identifier);
  if (!value) throw new Error('Task key or display name is required.');

  const byKey = await getRaidTask(value).catch(() => null);
  if (byKey) return byKey;

  return getRaidTaskByDisplayName(value);
}

export async function listRaidTasks({ includeInactive = true } = {}) {
  const tasks = await supabaseSelect('raid_tasks', {
    select: '*',
    order: [
      { column: 'category', direction: 'asc' },
      { column: 'sort_order', direction: 'asc' },
      { column: 'display_name', direction: 'asc' },
    ],
  });
  return includeInactive ? (tasks ?? []) : (tasks ?? []).filter((task) => task.active);
}

export async function listRaidTaskCategories() {
  const categories = await supabaseSelect('raid_task_categories', {
    select: '*',
    order: [
      { column: 'sort_order', direction: 'asc' },
      { column: 'display_name', direction: 'asc' },
    ],
  });

  if (categories?.length) return categories;

  const tasks = await listRaidTasks({ includeInactive: true });
  const byCategory = new Map();
  for (const task of tasks) {
    const key = normalizeTaskKey(task.category || 'generic') || 'generic';
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        key,
        display_name: formatCategoryLabel(key),
        sort_order: byCategory.size * 10,
      });
    }
  }
  return [...byCategory.values()];
}

export async function getRaidTaskCategory(key) {
  const categoryKey = normalizeTaskKey(key);
  if (!categoryKey) throw new Error('Category is required.');

  const data = await supabaseSelectOne('raid_task_categories', { filters: [{ column: 'key', op: 'eq', value: categoryKey }] });
  if (data) return data;
  return {
    key: categoryKey,
    display_name: formatCategoryLabel(categoryKey),
    sort_order: 0,
  };
}

export async function upsertRaidTaskCategory(input = {}) {
  const displayName = normalizeLooseText(input.displayName ?? input.display_name ?? input.name);
  const key = normalizeTaskKey(input.key ?? displayName);
  if (!key) throw new Error('Category name is required.');

  const sortOrder = Number(input.sortOrder ?? input.sort_order ?? 0);
  if (!Number.isFinite(sortOrder)) throw new Error('Category sort order must be a number.');

  const row = {
    key,
    display_name: displayName || formatCategoryLabel(key),
    sort_order: Math.floor(sortOrder),
  };

  await supabaseUpsert('raid_task_categories', row, { onConflict: 'key' });
  return getRaidTaskCategory(key);
}

export async function updateRaidTaskCategory(categoryKey, patch = {}) {
  const existing = await getRaidTaskCategory(categoryKey);
  const nextDisplayName = patch.displayName ?? patch.display_name ?? existing.display_name;
  const nextKey = normalizeTaskKey(patch.key ?? existing.key);
  if (!nextKey) throw new Error('Category name is required.');

  const nextSort = Number(patch.sortOrder ?? patch.sort_order ?? existing.sort_order ?? 0);
  if (!Number.isFinite(nextSort)) throw new Error('Category sort order must be a number.');

  const row = {
    key: nextKey,
    display_name: normalizeLooseText(nextDisplayName) || formatCategoryLabel(nextKey),
    sort_order: Math.floor(nextSort),
  };

  if (nextKey !== existing.key) {
    await supabaseUpsert('raid_task_categories', row, { onConflict: 'key' });
    await supabaseUpdate('raid_tasks', { category: nextKey }, [{ column: 'category', op: 'eq', value: existing.key }]);
    await supabaseDelete('raid_task_categories', [{ column: 'key', op: 'eq', value: existing.key }]);
  } else {
    await supabaseUpsert('raid_task_categories', row, { onConflict: 'key' });
  }

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after category update:', error?.message || error);
  });

  return getRaidTaskCategory(nextKey);
}

export async function deleteRaidTaskCategory(categoryKey, { deleteTasks = false } = {}) {
  const existing = await getRaidTaskCategory(categoryKey);

  if (deleteTasks) {
    await supabaseDelete('raid_tasks', [{ column: 'category', op: 'eq', value: existing.key }]);
  } else {
    await supabaseUpdate('raid_tasks', { category: 'generic' }, [{ column: 'category', op: 'eq', value: existing.key }]);
  }

  await supabaseDelete('raid_task_categories', [{ column: 'key', op: 'eq', value: existing.key }]);

  await loadRaidTasksCache().catch((cacheError) => {
    console.warn('Failed to refresh raid task cache after category delete:', cacheError?.message || cacheError);
  });

  return existing;
}

export async function reorderRaidTasks(category, orderedKeys = []) {
  const categoryKey = normalizeTaskKey(category);
  const keys = orderedKeys.map(normalizeTaskKey).filter(Boolean);
  if (!categoryKey || !keys.length) return [];

  const tasks = await listRaidTasksByCategory(categoryKey, { includeInactive: true });
  const valid = new Set(tasks.map((task) => task.key));
  const selected = keys.filter((key, index) => valid.has(key) && keys.indexOf(key) === index);
  if (!selected.length) return tasks;

  for (const [index, key] of selected.entries()) {
    await supabaseUpsert('raid_tasks', { key, sort_order: (index + 1) * 10, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }

  let nextOrder = (selected.length + 1) * 10;
  for (const task of tasks) {
    if (selected.includes(task.key)) continue;
    await supabaseUpsert('raid_tasks', { key: task.key, sort_order: nextOrder, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    nextOrder += 10;
  }

  await loadRaidTasksCache().catch((cacheError) => {
    console.warn('Failed to refresh raid task cache after reorder:', cacheError?.message || cacheError);
  });

  return listRaidTasksByCategory(categoryKey, { includeInactive: true });
}

export async function listRaidTasksByCategory(category, { includeInactive = true } = {}) {
  const categoryKey = normalizeTaskKey(category);
  if (!categoryKey) return [];
  const tasks = await supabaseSelect('raid_tasks', {
    select: '*',
    filters: [{ column: 'category', op: 'eq', value: categoryKey }],
    order: [
      { column: 'sort_order', direction: 'asc' },
      { column: 'display_name', direction: 'asc' },
    ],
  });
  return includeInactive ? (tasks ?? []) : (tasks ?? []).filter((task) => task.active);
}

export async function upsertRaidTask(input = {}) {
  const existing = await resolveRaidTask(input.key ?? input.displayName ?? input.display_name ?? input.name).catch(() => null);
  const row = toTaskRow({ ...input, key: existing?.key }, { partial: false });
  await supabaseUpsert('raid_tasks', { ...row, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after upsert:', error?.message || error);
  });

  return getRaidTask(row.key);
}

export async function updateRaidTask(identifier, patch = {}) {
  const existing = await resolveRaidTask(identifier);
  if (!existing) throw new Error(`Task \`${identifier}\` does not exist yet. Use /modifytasks to create it.`);

  const row = toTaskRow({ ...patch, key: existing.key }, { partial: true });
  delete row.key;

  if (!Object.keys(row).length) return existing;

  await supabaseUpsert('raid_tasks', {
    key: existing.key,
    ...row,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after update:', error?.message || error);
  });

  return getRaidTask(existing.key);
}

export async function deleteRaidTask(identifier) {
  const existing = await resolveRaidTask(identifier);
  if (!existing) throw new Error(`Task \`${identifier}\` does not exist.`);

  await supabaseDelete('raid_tasks', [{ column: 'key', op: 'eq', value: existing.key }]);

  await loadRaidTasksCache().catch((cacheError) => {
    console.warn('Failed to refresh raid task cache after delete:', cacheError?.message || cacheError);
  });

  return existing;
}

export function formatRaidTaskSummary(task) {
  const description = task?.description ? `\nDescription: ${task.description}` : '';

  return [
    `Task: ${task.display_name} (${task.active ? 'available' : 'unavailable'})`,
    `Points: ${task.points}`,
    `Category: ${task.category}`,
    `Order: ${task.sort_order}${description}`,
  ].join('\n');
}
