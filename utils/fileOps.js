// utils/fileOps.js
import Redis from 'ioredis'; // Import the Redis library
import { LEADERBOARD_FILE } from '../config/constants.js'; // This constant is no longer used but can be kept for reference.

// --- Initialize Redis Client ---
// Use the REDIS_URL environment variable provided by Render.
// The `maxRetriesPerRequest` helps prevent an infinite loop of connection attempts on errors.
const redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1
});

redisClient.on('connect', () => {
    console.log('Successfully connected to Redis!');
});

redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
    // You might want to handle this error more gracefully, e.g., by logging or restarting the bot.
});

// The key we will use in Redis to store our leaderboard data.
const REDIS_LEADERBOARD_KEY = 'leaderboard_data';

/**
 * Reads the leaderboard data from Redis.
 * Initializes the data in Redis with a basic structure if it doesn't exist.
 * @returns {Promise<Object>} The leaderboard data.
 */
export async function readLeaderboard() {
    try {
        // Use a transaction (MULTI/EXEC) to ensure atomicity for reading and setting
        // the initial data, preventing race conditions.
        const multi = redisClient.multi();
        multi.get(REDIS_LEADERBOARD_KEY);
        multi.setnx(REDIS_LEADERBOARD_KEY, JSON.stringify({ _lastResetDate: null, _dailyPoints: {} }));
        
        // Execute the transaction
        const [data] = await multi.exec();
        
        // The `get` command is the first in the transaction, so its result is `data[0]`.
        // The `setnx` command returns 1 if it set the key, 0 if it didn't.
        const leaderboardData = data[1] ? data[1] : data[0]; // If setnx ran, use the default data. Otherwise, use the data from the get.
        
        const parsedData = JSON.parse(leaderboardData);
        
        // Ensure _dailyPoints is always an object, even if missing from old data
        if (!parsedData._dailyPoints) {
            parsedData._dailyPoints = {};
        }
        return parsedData;

    } catch (error) {
        console.error('Error reading leaderboard from Redis:', error);
        throw error;
    }
}

/**
 * Writes the leaderboard data to Redis.
 * @param {Object} leaderboardData - The data to write.
 * @returns {Promise<void>}
 */
export async function writeLeaderboard(leaderboardData) {
    try {
        // Use `JSON.stringify` to convert the JavaScript object to a string before storing it in Redis.
        await redisClient.set(REDIS_LEADERBOARD_KEY, JSON.stringify(leaderboardData, null, 2));
    } catch (error) {
        console.error('Error writing leaderboard to Redis:', error);
        throw error;
    }
}

/**
 * Updates a user's total points and records daily points.
 * NOTE: This read-modify-write pattern is susceptible to a race condition.
 * For this use case, it is likely acceptable, but for high-traffic scenarios,
 * you would use Redis commands like `HINCRBY` or Lua scripts for atomicity.
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