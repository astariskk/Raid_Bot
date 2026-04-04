import { TASK_CATEGORY_BY_TASK } from '../config/constants.js';

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
