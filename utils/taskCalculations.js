// utils/taskCalculations.js
// This file contains a helper function to calculate points for tasks,
// including support for multipliers and meta-categories.

import {
    POINTS_CONFIG,
    MAX_XP_PER_RAID,
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
        const resolvedName = taskName;
        if (!Object.prototype.hasOwnProperty.call(POINTS_CONFIG, resolvedName)) {
            unknownTasks.push(entry);
            continue;
        }

        currentEntryPoints += POINTS_CONFIG[resolvedName];

        // Apply multiplier to the current entry's total points
        const taskPoints = currentEntryPoints * multiplier;
        originalTotalCalculatedPoints += taskPoints;

        // Add to breakdown for display
        if (taskPoints > 0) {
            calculatedBreakdown.push(`${resolvedName}${multiplier > 1 ? `x${multiplier}` : ''}: ${taskPoints} EXP`);
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
