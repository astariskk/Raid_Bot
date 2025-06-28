// utils/fileOps.js
import fs from 'node:fs/promises'; // Ensure this import is at the top
import { LEADERBOARD_FILE } from '../config/constants.js'; // Ensure this import is present

/**
 * Reads the leaderboard data from the JSON file.
 * Initializes the file with a basic structure if it doesn't exist.
 * @returns {Promise<Object>} The leaderboard data.
 */
export async function readLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        // Ensure _dailyPoints is always an object, even if missing from old file
        if (!parsedData._dailyPoints) {
            parsedData._dailyPoints = {};
        }
        return parsedData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File does not exist, return and create an empty leaderboard structure
            const initialData = { _lastResetDate: null, _dailyPoints: {} };
            await writeLeaderboard(initialData); // Create the file
            return initialData;
        }
        console.error('Error reading leaderboard file:', error);
        throw error;
    }
}

/**
 * Writes the leaderboard data to the JSON file.
 * @param {Object} leaderboardData - The data to write.
 * @returns {Promise<void>}
 */
export async function writeLeaderboard(leaderboardData) {
    try {
        await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderboardData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error writing leaderboard file:', error);
        throw error;
    }
}

/**
 * Updates a user's total points and records daily points.
 * @param {string} userId - The ID of the user.
 * @param {number} pointsToAdd - The points to add (can be negative for subtraction).
 * @returns {Promise<void>}
 */
export async function updateLeaderboard(userId, pointsToAdd) {
    let leaderboard = await readLeaderboard();

    // Update total points
    leaderboard[userId] = (leaderboard[userId] || 0) + pointsToAdd;

    // Update daily points
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    if (!leaderboard._dailyPoints) {
        leaderboard._dailyPoints = {};
    }
    if (!leaderboard._dailyPoints[today]) {
        leaderboard._dailyPoints[today] = {};
    }
    leaderboard._dailyPoints[today][userId] = (leaderboard._dailyPoints[today][userId] || 0) + pointsToAdd;

    await writeLeaderboard(leaderboard);
}
