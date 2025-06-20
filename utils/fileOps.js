// utils/fileOps.js
import fs from 'fs/promises';
import { LEADERBOARD_FILE } from '../index.js'; // Import LEADERBOARD_FILE constant

export async function readLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {}; // File not found, return empty object
        }
        console.error('Error reading leaderboard file:', error);
        return {};
    }
}

export async function writeLeaderboard(leaderboardData) {
    try {
        await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderboardData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error writing leaderboard file:', error);
    }
}

export async function updateLeaderboard(userId, points) {
    const leaderboard = await readLeaderboard();
    leaderboard[userId] = (leaderboard[userId] || 0) + points;
    await writeLeaderboard(leaderboard);
}