// utils/taskCalculations.js
// This file contains a helper function to calculate points for tasks,
// including support for multipliers and meta-categories.

import {
    POINTS_CONFIG,
    MAX_XP_PER_RAID,
    TASK_MAP_CATEGORIES,
    ALLOWED_TASK_NAMES,
    TASK_ALIASES,
} from '../config/constants.js';


export function calculateTaskPointsWithMultiplier(tasksString) {
    // Updated to split tasks by '+' or ','
    const rawTaskEntries = tasksString.split(/[+,]/).map(task => task.trim()).filter(task => task.length > 0);

    let originalTotalCalculatedPoints = 0;
    const unknownTasks = [];
    const calculatedBreakdown = [];

    for (const entry of rawTaskEntries) {
        const taskMatch = entry.match(/^(.+?)(x(\d+))?$/i); // Regex to capture task name and optional multiplier
        if (!taskMatch) {
            unknownTasks.push(entry);
            continue;
        }

        let taskName = taskMatch[1].trim().toLowerCase();
        const multiplier = taskMatch[3] ? parseInt(taskMatch[3], 10) : 1;

        if (isNaN(multiplier) || multiplier < 1) {
            unknownTasks.push(entry);
            continue;
        }

        let currentEntryPoints = 0;
        let effectiveTasks = new Set();

        // Handle meta categories (e.g., 'daily', 'weekly')
        if (TASK_MAP_CATEGORIES.hasOwnProperty(taskName)) {
            TASK_MAP_CATEGORIES[taskName].forEach(t => effectiveTasks.add(t));
        }
        // Handle direct task names (e.g., 'speaker', 'kathool')
        else if (POINTS_CONFIG.hasOwnProperty(taskName)) {
            effectiveTasks.add(taskName);
        }
        // Handle aliases (e.g., 'drakath' -> 'drak')
        else if (TASK_ALIASES.hasOwnProperty(taskName)) {
            effectiveTasks.add(TASK_ALIASES[taskName]);
        }
        // If neither a meta category nor a direct task, mark as unknown
        else {
            unknownTasks.push(entry);
            continue;
        }

        effectiveTasks.forEach(t => {
            if (POINTS_CONFIG.hasOwnProperty(t)) {
                currentEntryPoints += POINTS_CONFIG[t];
            } else {
                // This case should ideally not happen if POINTS_CONFIG is comprehensive for all tasks in TASK_MAP_CATEGORIES
                console.warn(`Task "${t}" from category "${taskName}" not found in POINTS_CONFIG.`);
                unknownTasks.push(t); // Add specific sub-task if not found
            }
        });

        // Apply multiplier to the current entry's total points
        const taskPoints = currentEntryPoints * multiplier;
        originalTotalCalculatedPoints += taskPoints;

        // Add to breakdown for display
        if (taskPoints > 0) {
            calculatedBreakdown.push(`\`${taskName}${multiplier > 1 ? `x${multiplier}` : ''}\`: ${taskPoints} EXP`);
        }
    }

    // Apply the MAX_XP_PER_RAID cap to the calculated total
    let totalCalculatedPoints = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);

    return {
        totalCalculatedPoints,
        originalTotalCalculatedPoints,
        calculatedBreakdown,
        unknownTasks
    };
}
