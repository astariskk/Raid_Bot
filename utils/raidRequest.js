import { RAID_TASK_CATEGORIES, TASK_CATEGORY_BY_TASK, RAID_TYPE } from '../config/constants.js';

const raidTypeByCategoryKey = new Map(
  (RAID_TASK_CATEGORIES || []).map((c) => [c.key, c.raidType]),
);

export function inferCategoryKeysFromTasks(tasks) {
  const keys = new Set();
  for (const t of tasks || []) {
    const task = String(t ?? '').trim().toLowerCase();
    if (!task) continue;

    const categoryKey = TASK_CATEGORY_BY_TASK?.[task];
    if (categoryKey) keys.add(categoryKey);
  }
  return [...keys];
}

export function inferRaidTypeFromCategoryKeys(categoryKeys) {
  const keys = (categoryKeys || []).filter(Boolean);
  if (!keys.length) return RAID_TYPE.OTHER;

  const typeSet = new Set();
  for (const key of keys) {
    typeSet.add(raidTypeByCategoryKey.get(key) ?? RAID_TYPE.OTHER);
  }

  if (typeSet.size === 1) return [...typeSet][0] ?? RAID_TYPE.OTHER;
  return RAID_TYPE.OTHER;
}
