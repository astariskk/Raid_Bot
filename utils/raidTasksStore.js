import { loadRaidTasksCache } from '../config/constants/tasks.js';
import { connectMongo, getMongoDb } from './mongoClient.js';

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

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection('raid_tasks').findOne({ key: taskKey }, { projection: { _id: 0 } });
  return data ?? null;
}

export async function getRaidTaskByDisplayName(displayName) {
  const name = normalizeLooseText(displayName);
  if (!name) throw new Error('Task display name is required.');

  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection('raid_tasks').findOne(
    { display_name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
    { projection: { _id: 0 } },
  );
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
  await connectMongo();
  const db = getMongoDb();
  const filter = includeInactive ? {} : { active: true };
  const data = await db.collection('raid_tasks')
    .find(filter, { projection: { _id: 0 } })
    .sort({ category: 1, sort_order: 1, display_name: 1 })
    .toArray();
  return data ?? [];
}

export async function listRaidTaskCategories() {
  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection('raid_task_categories')
    .find({}, { projection: { _id: 0 } })
    .sort({ sort_order: 1, display_name: 1 })
    .toArray();

  if (data.length) return data;

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

  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection('raid_task_categories').findOne({ key: categoryKey }, { projection: { _id: 0 } });

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

  await connectMongo();
  const db = getMongoDb();
  await db.collection('raid_task_categories').updateOne(
    { key },
    { $set: { ...row, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
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

  await connectMongo();
  const db = getMongoDb();
  if (nextKey !== existing.key) {
    await db.collection('raid_task_categories').updateOne({ key: nextKey }, { $set: { ...row, updated_at: new Date() } }, { upsert: true });
    await db.collection('raid_tasks').updateMany({ category: existing.key }, { $set: { category: nextKey, updated_at: new Date() } });
    await db.collection('raid_task_categories').deleteOne({ key: existing.key });
  } else {
    await db.collection('raid_task_categories').updateOne({ key: existing.key }, { $set: { ...row, updated_at: new Date() } });
  }

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after category update:', error?.message || error);
  });

  return getRaidTaskCategory(nextKey);
}

export async function deleteRaidTaskCategory(categoryKey, { deleteTasks = false } = {}) {
  const existing = await getRaidTaskCategory(categoryKey);
  await connectMongo();
  const db = getMongoDb();

  if (deleteTasks) {
    await db.collection('raid_tasks').deleteMany({ category: existing.key });
  } else {
    await db.collection('raid_tasks').updateMany({ category: existing.key }, { $set: { category: 'generic', updated_at: new Date() } });
  }

  await db.collection('raid_task_categories').deleteOne({ key: existing.key });

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

  await connectMongo();
  const db = getMongoDb();
  for (const [index, key] of selected.entries()) {
    await db.collection('raid_tasks').updateOne({ key }, { $set: { sort_order: (index + 1) * 10, updated_at: new Date() } });
  }

  let nextOrder = (selected.length + 1) * 10;
  for (const task of tasks) {
    if (selected.includes(task.key)) continue;
    await db.collection('raid_tasks').updateOne({ key: task.key }, { $set: { sort_order: nextOrder, updated_at: new Date() } });
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

  await connectMongo();
  const db = getMongoDb();
  const filter = { category: categoryKey };
  if (!includeInactive) filter.active = true;
  const data = await db.collection('raid_tasks')
    .find(filter, { projection: { _id: 0 } })
    .sort({ sort_order: 1, display_name: 1 })
    .toArray();
  return data ?? [];
}

export async function upsertRaidTask(input = {}) {
  const existing = await resolveRaidTask(input.key ?? input.displayName ?? input.display_name ?? input.name).catch(() => null);
  const row = toTaskRow({ ...input, key: existing?.key }, { partial: false });
  await connectMongo();
  const db = getMongoDb();

  await db.collection('raid_tasks').updateOne(
    { key: row.key },
    { $set: { ...row, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );

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

  await connectMongo();
  const db = getMongoDb();
  await db.collection('raid_tasks').updateOne({ key: existing.key }, { $set: { ...row, updated_at: new Date() } });

  await loadRaidTasksCache().catch((error) => {
    console.warn('Failed to refresh raid task cache after update:', error?.message || error);
  });

  return getRaidTask(existing.key);
}

export async function deleteRaidTask(identifier) {
  const existing = await resolveRaidTask(identifier);
  if (!existing) throw new Error(`Task \`${identifier}\` does not exist.`);

  await connectMongo();
  const db = getMongoDb();
  await db.collection('raid_tasks').deleteOne({ key: existing.key });

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
