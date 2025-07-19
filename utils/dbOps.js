// utils/dbOps.js

import { MongoClient } from 'mongodb';

const DB_NAME = 'raid_bot_db'; // You can change your database name here

let dbClient;
let leaderboardCollection;
let dailyPointsCollection;
let metadataCollection;

/**
 * Connects to the MongoDB database.
 * @returns {Promise<void>}
 */
export async function connectDB() {
    // Read the variable INSIDE the function
    const MONGODB_URI = process.env.MONGODB_URI;

    if (dbClient && dbClient.topology.isConnected()) {
        console.log('Already connected to MongoDB.');
        return;
    }

    if (!MONGODB_URI) { // <-- Now this check will work correctly
        console.error('MONGODB_URI is not defined in environment variables. Please set it.');
        throw new Error('MONGODB_URI is not defined.');
    }

    try {
        dbClient = new MongoClient(MONGODB_URI);
        await dbClient.connect();
        console.log('Connected to MongoDB successfully!');

        const db = dbClient.db(DB_NAME);
        leaderboardCollection = db.collection('leaderboard_data');
        dailyPointsCollection = db.collection('daily_points');
        metadataCollection = db.collection('metadata');

        // Ensure indexes for efficient queries if needed
        // The unique: true option was removed from _id index as it's redundant and caused an error.
        // _id is always unique by default.
        await leaderboardCollection.createIndex({ totalExp: -1 }).catch(console.error);
        await dailyPointsCollection.createIndex({ date: 1, userId: 1 }, { unique: true }).catch(console.error);
        await metadataCollection.createIndex({ _id: 1 }).catch(console.error); // FIX: Removed { unique: true }

    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

/**
 * Closes the MongoDB connection.
 * @returns {Promise<void>}
*/
export async function closeDB() {
    if (dbClient && dbClient.topology.isConnected()) {
        await dbClient.close();
        console.log('MongoDB connection closed.');
    }
}

/**
 * Fetches the entire leaderboard data from MongoDB.
 * Combines user total EXP and metadata.
 * @returns {Promise<Object>} The leaderboard data object, including _lastResetDate and _dailyPoints.
 */
export async function getLeaderboardData() {
    try {
        await connectDB(); // Ensure connection is active

        const users = await leaderboardCollection.find({}).toArray();
        const metadataDoc = await metadataCollection.findOne({ _id: 'leaderboard_meta' });
        const dailyPointsDocs = await dailyPointsCollection.find({}).toArray();

        const leaderboard = {};

        // Populate total EXP
        users.forEach(user => {
            leaderboard[user._id] = user.totalExp;
        });

        // Populate metadata
        leaderboard._lastResetDate = metadataDoc ? metadataDoc.lastResetDate : null;

        // Populate daily points
        leaderboard._dailyPoints = {};
        dailyPointsDocs.forEach(doc => {
            if (!leaderboard._dailyPoints[doc.date]) {
                leaderboard._dailyPoints[doc.date] = {};
            }
            leaderboard._dailyPoints[doc.date][doc.userId] = doc.points;
        });

        // Ensure _dailyPoints is always an object, even if missing from old data
        if (!leaderboard._dailyPoints) {
            leaderboard._dailyPoints = {};
        }

        return leaderboard;
    } catch (error) {
        console.error('Error getting leaderboard data from DB:', error);
        throw error;
    }
}

/**
 * Sets the entire leaderboard data in MongoDB.
 * This is primarily used for full resets or initial setup.
 * @param {Object} leaderboardData - The data to write.
 * @returns {Promise<void>}
 */
export async function setLeaderboardData(leaderboardData) {
    try {
        await connectDB(); // Ensure connection is active

        // Clear existing data and insert new total EXP
        await leaderboardCollection.deleteMany({});
        const userDocs = Object.entries(leaderboardData)
            .filter(([key]) => !key.startsWith('_'))
            .map(([userId, totalExp]) => ({ _id: userId, totalExp: totalExp }));
        if (userDocs.length > 0) {
            await leaderboardCollection.insertMany(userDocs);
        }

        // Update metadata (last reset date)
        await metadataCollection.updateOne(
            { _id: 'leaderboard_meta' },
            { $set: { lastResetDate: leaderboardData._lastResetDate } },
            { upsert: true } // Insert if not exists
        );

        // Clear existing daily points and insert new ones
        await dailyPointsCollection.deleteMany({});
        const dailyPointsDocs = [];
        for (const date in leaderboardData._dailyPoints) {
            for (const userId in leaderboardData._dailyPoints[date]) {
                dailyPointsDocs.push({
                    _id: `${date}_${userId}`, // Unique ID for each daily entry
                    date: date,
                    userId: userId,
                    points: leaderboardData._dailyPoints[date][userId]
                });
            }
        }
        if (dailyPointsDocs.length > 0) {
            await dailyPointsCollection.insertMany(dailyPointsDocs);
        }

    } catch (error) {
        console.error('Error setting leaderboard data to DB:', error);
        throw error;
    }
}

/**
 * Updates a user's total points and records daily points in MongoDB.
 * This performs atomic updates.
 * @param {string} userId - The ID of the user.
 * @param {number} pointsToAdd - The points to add (can be negative for subtraction).
 * @returns {Promise<void>}
 */
export async function updateUserExp(userId, pointsToAdd) {
    try {
        await connectDB(); // Ensure connection is active

        // Update total points for the user
        await leaderboardCollection.updateOne(
            { _id: userId },
            { $inc: { totalExp: pointsToAdd } }, // Increment totalExp by pointsToAdd
            { upsert: true } // Create document if it doesn't exist
        );

        // Update daily points for the user
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        await dailyPointsCollection.updateOne(
            { date: today, userId: userId },
            { $inc: { points: pointsToAdd }, $set: { _id: `${today}_${userId}` } }, // Increment daily points, set unique ID
            { upsert: true } // Create document if it doesn't exist
        );
        console.log(`[dbOps] Recording daily EXP for userId: ${userId} on date: ${today} with points: ${pointsToAdd}`); // Add this line

    } catch (error) {
        console.error('Error updating user EXP in DB:', error);
        throw error;
    }
}

/**
 * Fetches daily points for a specific date range for specified users.
 * @param {string[]} userIds - Array of user IDs to fetch data for.
 * @param {Date} startDate - The start date (inclusive).
 * @param {Date} endDate - The end date (inclusive).
 * @returns {Promise<Array<{ date: string, userId: string, points: number }>>}
 */
export async function getDailyPointsForRange(userIds, startDate, endDate) {
    try {
        await connectDB(); // Ensure connection is active

        const startISO = startDate.toISOString().split('T')[0];
        const endISO = endDate.toISOString().split('T')[0];

        const query = {
            userId: { $in: userIds },
            date: { $gte: startISO, $lte: endISO }
        };
        console.log(`[dbOps] getDailyPointsForRange query: ${JSON.stringify(query)}`); // log the query for debugging

        const dailyData = await dailyPointsCollection.find(query).toArray();
        console.log(`[dbOps] getDailyPointsForRange found ${dailyData.length} records.`);   //log the number of records found
        // --- ADD THIS NEW LOG ---
        console.log(`[dbOps] Daily data retrieved:`, dailyData);           //log the retrieved daily data

        return dailyData;
    } catch (error) {
        console.error('Error fetching daily points for range from DB:', error);
        throw error;
    }
}
/**
 * Gets the last backup message ID from the metadata collection.
 * @returns {Promise<string|null>} The message ID or null if not found.
 */
export async function getLastBackupMessageId() {
    try {
        await connectDB();
        const metadataDoc = await metadataCollection.findOne({ _id: 'leaderboard_meta' });
        return metadataDoc ? metadataDoc.lastBackupMessageId : null;
    } catch (error) {
        console.error('Error getting last backup message ID from DB:', error);
        return null; // Return null on error to prevent crashing
    }
}

/**
 * Sets the last backup message ID in the metadata collection.
 * @param {string} messageId
 * @returns {Promise<void>}
 */
export async function setLastBackupMessageId(messageId) {
    try {
        await connectDB();
        await metadataCollection.updateOne(
            { _id: 'leaderboard_meta' },
            { $set: { lastBackupMessageId: messageId } },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error setting last backup message ID in DB:', error);
        throw error;
    }
}