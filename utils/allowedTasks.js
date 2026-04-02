import { 
    TASK_ALIASES,
    ALLOWED_TASK_FOUR,
    ALLOWED_TASK_SEVEN,
    GENERIC_TASKS_LIST,
} from '../config/constants.js'

function resolveTaskTokens(taskTokens) {
    let tasks = taskTokens
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter(Boolean)
        .map((t) => TASK_ALIASES[t] || t); // replace aliases

    // Remove duplicates while preserving order
    tasks = [...new Set(tasks)];
    return tasks;
}

function getAllowedTasksForType(raidType) {
    switch (raidType) {
        case '4-man':
            return ALLOWED_TASK_FOUR;
        case '7-man':
            return ALLOWED_TASK_SEVEN;
        case 'any':
            return [...new Set([...ALLOWED_TASK_FOUR, ...ALLOWED_TASK_SEVEN])];
        default:
            return [...GENERIC_TASKS_LIST];
    }
}

export function validateAndResolveTaskList(taskList, raidType) {
    const tasks = resolveTaskTokens(taskList);
    const allowed = getAllowedTasksForType(raidType);
    const invalid = tasks.filter((t) => !allowed.includes(t));

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
