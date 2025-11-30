import { 
    TASK_ALIASES,
    ALLOWED_TASK_FOUR,
    ALLOWED_TASK_SEVEN,
    ALLOWED_TASK_NAMES,
    GENERIC_TASKS_LIST,
} from '../config/constants.js'

export function validateAndResolveTasks(rawInput, raidType) {
    // Split and clean input
    let tasks = rawInput
        .split(/\s*[+,]\s*/)
        .map(t => t.trim().toLowerCase())
        .map(t => TASK_ALIASES[t] || t); // replace aliases

    // Remove duplicates
    tasks = [...new Set(tasks)];

    // Determine allowed tasks
    let allowed;
    switch(raidType) {
        case '4-man':
            allowed = ALLOWED_TASK_FOUR;
            break;
        case '7-man':
            allowed = ALLOWED_TASK_SEVEN;
            break;
        default:
            allowed = [...GENERIC_TASKS_LIST];
    }

    // Identify invalid tasks
    const invalid = tasks.filter(t => !allowed.includes(t));

    return {
        resolvedTasks: tasks,
        invalidTasks: invalid,
        allowedTasks: allowed
    };
}