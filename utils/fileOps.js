// utils/fileOps.js

// OLD: import { LEADERBOARD_FILE } from '../index.js';
import { LEADERBOARD_FILE } from '../config/constants.js'; // CORRECTED IMPORT

import fs from 'node:fs/promises';

// Function to read the leaderboard data
export async function readLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File does not exist, return an empty object
            return {};
        }
        console.error('Error reading leaderboard file:', error);
        return {}; // Return empty on other errors too, to prevent crash
    }
}

// Function to write the leaderboard data
export async function writeLeaderboard(leaderboard) {
    try {
        await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2), 'utf8');
    } catch (error) {
        console.error('Error writing leaderboard file:', error);
    }
}

// Function to update the leaderboard for a specific user
export async function updateLeaderboard(userId, points) {
    const leaderboard = await readLeaderboard();
    leaderboard[userId] = (leaderboard[userId] || 0) + points;
    await writeLeaderboard(leaderboard);
}

// Function to get the leaderboard as a sorted array for display
export async function getSortedLeaderboard() {
    const leaderboard = await readLeaderboard();
    return Object.entries(leaderboard).sort(([, a], [, b]) => b - a);
}