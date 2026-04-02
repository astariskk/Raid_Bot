import { 
    GENERIC_TASKS_LIST,
} from '../config/constants.js'

function resolveTaskTokens(taskTokens) {
    let tasks = taskTokens
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter(Boolean);

    // Remove duplicates while preserving order
    tasks = [...new Set(tasks)];
    return tasks;
}

function getAllowedTasksForType(raidType) {
    // Task allow-listing is disabled. Keep this helper for backwards compatibility.
    // For unknown tasks, users can use generic tasks (`simple`, `moderate`, `hard`) plus a description.
    if (raidType === 'any' || raidType === '4-man' || raidType === '7-man') return null;
    return [...GENERIC_TASKS_LIST];
}

export function validateAndResolveTaskList(taskList, raidType) {
    const tasks = resolveTaskTokens(taskList);
    const allowed = getAllowedTasksForType(raidType);
    const invalid = allowed ? tasks.filter((t) => !allowed.includes(t)) : [];

    return {
        resolvedTasks: tasks,
        invalidTasks: invalid,
        allowedTasks: allowed,
    };
}

export function validateAndResolveTasks(rawInput, raidType) {
    const tokens = String(rawInput ?? '').split(/\s*[+,]\s*/);
    return validateAndResolveTaskList(tokens, raidType);
}
