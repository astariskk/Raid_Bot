// leaderboardCore.js - Core logic for leaderboard data, embeds, and monthly task

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { RAID_CHANNEL_ID } from '../config/constants.js';
import { sendLeaderboardBackup } from './backupHandler.js'; // Assuming backupHandler is in 'handlers'

// Import database operations instead of file operations
import { connectDB, getLeaderboardData as fetchLeaderboardFromDB, setLeaderboardData as writeLeaderboardToDB, updateUserExp as updateExpInDB, getDailyPointsForRange } from '../utils/dbOps.js';

// --- Leaderboard Cache ---
const CACHE_LIFETIME_MS = 5 * 60 * 1000;
let leaderboardCache = null;
let lastCacheTime = 0;

/**
 * Fetches the current leaderboard data, utilizing a cache.
 * If the cache is stale or non-existent, it reads from the database and updates the cache.
 * @returns {Promise<Object>} The raw leaderboard data object.
 */
export async function getCachedLeaderboard() {
    const now = Date.now();
    // Check if cache exists and is still fresh.
    if (leaderboardCache && (now - lastCacheTime < CACHE_LIFETIME_MS)) {
        return leaderboardCache;
    }
    // If cache is stale or empty, read from database and update cache.
    leaderboardCache = await fetchLeaderboardFromDB();
    lastCacheTime = now;
    return leaderboardCache;
}

/**
 * Sorts leaderboard data and returns entries.
 * Filters out internal keys (those starting with '_') and optionally filters out 0 EXP.
 * @param {Object} leaderboard The raw leaderboard data.
 * @param {number} [limit=Infinity] The maximum number of top players to return. Defaults to all.
 * @param {boolean} [filterZeroExp=true] Whether to filter out players with 0 total EXP. Defaults to true.
 * @returns {Array<{userId: string, totalExp: number}>} An array of user objects sorted by totalExp.
 */
export function getSortedLeaderboard(leaderboard, limit = Infinity, filterZeroExp = true) {
    // Filter out internal keys like _lastResetDate and _dailyPoints.
    let userEntries = Object.entries(leaderboard).filter(([key]) => !key.startsWith('_'));

    let players = userEntries
        .map(([userId, totalExp]) => ({ userId, totalExp }));

    if (filterZeroExp) {
        players = players.filter(player => player.totalExp > 0);
    }

    return players
        .sort((a, b) => b.totalExp - a.totalExp)
        .slice(0, limit);
}

/**
 * Resets the leaderboard data, either fully or monthly.
 * A full reset clears all user points. A monthly reset sets all user points to 0
 * but keeps the user entries, and clears daily points.
 * @param {boolean} fullReset - If true, performs a full reset; otherwise, performs a monthly reset.
 */
export async function resetLeaderboard(fullReset = false) {
    const newLeaderboardState = {
        _lastResetDate: new Date().toISOString(),
        _dailyPoints: {} // This will be cleared in the database as well
    };

    // If not a full reset, we need to preserve existing user IDs with 0 points
    if (!fullReset) {
        const currentLeaderboard = await getCachedLeaderboard();
        for (const userId in currentLeaderboard) {
            if (!userId.startsWith('_')) {
                newLeaderboardState[userId] = 0; // Set existing users' total EXP to 0
            }
        }
    }

    await writeLeaderboardToDB(newLeaderboardState); // Write the new state to DB
    leaderboardCache = null; // Invalidate cache after reset.

    if (fullReset) {
        console.log('Full leaderboard reset initiated (all user entries removed).');
    } else {
        console.log('Monthly leaderboard reset initiated (existing user EXP set to 0).');
    }
}

/**
 * Updates a user's total points and records daily points in MongoDB.
 * This function will be called from leaderboardHandler.js commands.
 * @param {string} userId - The ID of the user.
 * @param {number} pointsToAdd - The points to add (can be negative for subtraction).
 * @returns {Promise<void>}
 */
export async function updateLeaderboard(userId, pointsToAdd) {
    await updateExpInDB(userId, pointsToAdd);
    leaderboardCache = null; // Invalidate cache so next read fetches fresh data
}


/**
 * Creates and returns a Discord EmbedBuilder instance for the paginated main leaderboard.
 * It resolves user IDs to display names for better readability.
 * @param {Object} sessionData - The session data for the leaderboard (containing current page, total pages, user data).
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {import('discord.js').Guild} guild - The guild where the command was invoked.
 * @returns {Promise<{embeds: EmbedBuilder[], components: ActionRowBuilder[]}>} An object containing the embed and pagination buttons.
 */
export async function createPaginatedLeaderboardEmbed(sessionData, client, guild) {
    const { currentPage, totalPages, usersData, resetInfo, originalRequesterId, timestamp } = sessionData;
    const USERS_PER_PAGE = 10; // Number of users to display per page for the main leaderboard.

    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, usersData.length);
    const usersOnPage = usersData.slice(startIndex, endIndex); // Get users for the current page.

    const embed = new EmbedBuilder()
        .setColor(0x0099FF) // Blue color.
        .setTitle('🏆 Raid Leaderboard 🏆')
        .setDescription(`Current Leaderboard by Total EXP!\n\n${resetInfo}`)
        .setTimestamp()
        .setFooter({ text: `Page ${currentPage}/${totalPages} | Raid Helper Bot | Keep raiding for more points!` });

    if (usersOnPage.length === 0) {
        embed.addFields({ name: 'No Data Yet', value: 'The leaderboard is empty. Start earning some EXP!' });
    } else {
        for (let i = 0; i < usersOnPage.length; i++) {
            const player = usersOnPage[i];
            let userName = `<@${player.userId}>`;
            try {
                const member = await guild.members.fetch(player.userId);
                userName = member.displayName;
            } catch (error) {
                try {
                    const user = await client.users.fetch(player.userId);
                    userName = user.username;
                } catch (userError) {
                    console.error(`Could not resolve user ID ${player.userId}:`, userError);
                }
            }
            embed.addFields({
                name: `${startIndex + i + 1}. ${userName}`, // Correct ranking for the page
                value: `${player.totalExp} EXP`,
                inline: false
            });
        }
    }

    // Create pagination buttons.
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`lb_prev_${originalRequesterId}_${timestamp}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lb_next_${originalRequesterId}_${timestamp}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages)
        );

    return { embeds: [embed], components: [row] };
}


/**
 * Creates the `!lbcheck` embed and pagination buttons for a given page.
 * This function is used to dynamically update the leaderboard check message as users paginate.
 * @param {Object} sessionData - The session data for `!lbcheck` (containing current page, total pages, user data, date info).
 * @param {import('discord.js').Client} client - The Discord client instance (for potential future use, currently not directly used here).
 * @param {import('discord.js').Guild} guild - The guild where the command was invoked (for display name resolution).
 * @returns {Promise<{embeds: EmbedBuilder[], components: ActionRowBuilder[]}>} An object containing the embed and pagination buttons.
 */
export async function createLbCheckResponse(sessionData, client, guild) {
    const { currentPage, totalPages, usersData, dateInfo, originalRequesterId, timestamp } = sessionData;
    const USERS_PER_PAGE = 5; // Number of users to display per page.

    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, usersData.length);
    const usersOnPage = usersData.slice(startIndex, endIndex); // Get users for the current page.

    const embed = new EmbedBuilder()
        .setColor(0x0099FF) // Blue color.
        .setTitle(`📊 EXP Check ${dateInfo.description} 📊`)
        .setTimestamp()
        .setFooter({ text: `Page ${currentPage}/${totalPages} | Raid Helper Bot | EXP Breakdown` });

    let descriptionContent = '';

    if (usersOnPage.length === 0) {
        descriptionContent = 'No EXP data found for this page.';
    } else {
        for (const userData of usersOnPage) {
            descriptionContent += `**${userData.displayName}**\n`;
            if (dateInfo.rawStartDate.getTime() === dateInfo.rawEndDate.getTime()) {
                descriptionContent += `• EXP Gained: ${userData.totalPointsForRange} EXP\n`;
            } else {
                descriptionContent += `• Total EXP in range: ${userData.totalPointsForRange} EXP\n`;
                if (userData.dailyBreakdown.length > 1 && userData.totalPointsForRange > 0) {
                    descriptionContent += `  Breakdown:\n`;
                    const maxBreakdownLines = 5;
                    if (userData.dailyBreakdown.length > maxBreakdownLines) {
                        descriptionContent += userData.dailyBreakdown.slice(0, Math.ceil(maxBreakdownLines / 2)).join('\n') + '\n';
                        descriptionContent += `  ... (${userData.dailyBreakdown.length - Math.floor(maxBreakdownLines / 2) - Math.ceil(maxBreakdownLines / 2)} more days) ...\n`;
                        descriptionContent += userData.dailyBreakdown.slice(-Math.floor(maxBreakdownLines / 2)).join('\n') + '\n';
                    } else {
                        descriptionContent += userData.dailyBreakdown.join('\n') + '\n';
                    }
                }
            }
            descriptionContent += `• Overall Total EXP: ${userData.overallTotal} EXP\n\n`;
        }
    }
    embed.setDescription(descriptionContent);

    // Create pagination buttons.
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`lbcheck_prev_${originalRequesterId}_${timestamp}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lbcheck_next_${originalRequesterId}_${timestamp}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages)
        );

    return { embeds: [embed], components: [row] };
}

/**
 * Sets up the scheduled task for monthly leaderboard reset.
 * @param {import('discord.js').Client} client - The Discord client instance.
 */
export function setupMonthlyResetTask(client) {
    const performMonthlyCheck = async () => {
        try {
            const leaderboard = await getCachedLeaderboard(); // Use cached version for consistency
            const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
            const now = new Date();

            // Check if it's a new month or if there's no last reset date recorded.
            if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
                console.log('Performing automatic monthly leaderboard reset...');

                // Announce the reset in the RAID_CHANNEL_ID.
                try {
                    const raidChannel = await client.channels.fetch(RAID_CHANNEL_ID);
                    if (raidChannel && raidChannel.isTextBased()) {
                        // Fetch the top players just before reset for the announcement.
                        const oldLeaderboard = await getCachedLeaderboard();
                        const topPlayersBeforeReset = getSortedLeaderboard(oldLeaderboard, 10, true); // Get top 10 for old leaderboard
                        const guild = client.guilds.cache.first(); // Get the first guild the bot is in, assuming one main guild.
                        if (guild) {
                            const embed = await createPaginatedLeaderboardEmbed({ // Use the new function for consistency
                                currentPage: 1,
                                totalPages: 1,
                                usersData: topPlayersBeforeReset,
                                resetInfo: "Final Leaderboard for Last Month",
                                originalRequesterId: 'scheduled_reset', // Use a dummy ID for scheduled tasks
                                timestamp: Date.now()
                            }, client, guild);
                            await raidChannel.send({ embeds: embed.embeds, components: [] }); // No buttons for final announcement
                            await raidChannel.send('📈 The monthly leaderboard has been automatically reset! Good luck this month, raiders!');
                        } else {
                            console.warn('No guild found to create leaderboard embed for announcement.');
                        }
                    } else {
                        console.warn(`RAID_CHANNEL_ID (${RAID_CHANNEL_ID}) is not a text channel or could not be fetched.`);
                    }
                } catch (channelError) {
                    console.error('Error sending leaderboard reset announcement:', channelError);
                }

                await resetLeaderboard(false);
                await sendLeaderboardBackup(client);
            }
        } catch (error) {
            console.error('Error in monthly leaderboard reset check:', error);
        }
    };
    
    // Run the check once immediately when the bot starts
    performMonthlyCheck();

    // Then, set up the recurring check every 12 hours
    setInterval(performMonthlyCheck, 12 * 60 * 60 * 1000);
}
export {
    getDailyPointsForRange // <--- ADD THIS LINE TO THE EXPORT LIST
};