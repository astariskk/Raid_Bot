// handlers/leaderboardHandler.js
// This file handles all leaderboard-related functionalities for the Discord bot,
// including displaying the top players, checking individual/daily EXP,
// and administrative commands for adding/removing/resetting EXP.

// Import necessary Discord.js components for embeds, buttons, and action rows.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
// Import file operations utilities for reading and writing leaderboard data.
import { readLeaderboard, writeLeaderboard, updateLeaderboard } from '../utils/fileOps.js';
// Import constants for file paths, role IDs, and channel IDs.
import { LEADERBOARD_FILE, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID, RAID_CHANNEL_ID } from '../config/constants.js';
import fs from 'node:fs/promises'; // Import Node.js 'fs/promises' for file operations.


// --- Leaderboard Cache ---
// Cache for leaderboard data to reduce file I/O and improve response times.
const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes cache lifetime.
let leaderboardCache = null; // Stores the cached leaderboard object.
let lastCacheTime = 0; // Timestamp of the last cache update.

// --- Pending Reset Confirmations ---
// Used to store temporary state for `!resetlb` command, requiring user confirmation.
// Map<userId, { timestamp: Date, fullReset: boolean, channelId: string }>
const pendingResets = new Map();
const RESET_CONFIRMATION_TIMEOUT_MS = 30 * 1000; // 30 seconds for confirmation timeout.

// --- Active !lbcheck Sessions for Pagination ---
// Stores session data for `!lbcheck` command's paginated results.
// Map<messageId (of the bot's sent embed), { currentPage: number, totalPages: number, usersData: Array, dateInfo: Object, originalRequesterId: string, timeoutId: NodeJS.Timeout }>
const activeLbCheckSessions = new Map();
const LBCHECK_SESSION_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes for `!lbcheck` pagination session.

/**
 * Checks if the message author has the designated MODERATOR_ROLE_ID or OFFICER_ROLE_ID.
 * This function is used to gate administrative commands.
 * @param {import('discord.js').Message} message The Discord message object.
 * @returns {boolean} True if the author has either role, false otherwise.
 */
function isAdmin(message) {
    // Checks if the member exists and has either the Moderator, Officer, or Raid Manager role.
    return message.member && (message.member.roles.cache.has(MODERATOR_ROLE_ID) || message.member.roles.cache.has(OFFICER_ROLE_ID) || message.member.roles.cache.has(RAID_MANAGER_ROLE_ID));
}

/**
 * Fetches the current leaderboard data, utilizing a cache.
 * If the cache is stale or non-existent, it reads from the file and updates the cache.
 * @returns {Promise<Object>} The raw leaderboard data object.
 */
async function getCachedLeaderboard() {
    const now = Date.now();
    // Check if cache exists and is still fresh.
    if (leaderboardCache && (now - lastCacheTime < CACHE_LIFETIME_MS)) {
        return leaderboardCache;
    }
    // If cache is stale or empty, read from file and update cache.
    leaderboardCache = await readLeaderboard();
    lastCacheTime = now;
    return leaderboardCache;
}

/**
 * Sorts leaderboard data and returns top N entries.
 * Filters out internal keys (those starting with '_') to only include user data.
 * @param {Object} leaderboard - The raw leaderboard object (e.g., from `getCachedLeaderboard`).
 * @param {number} limit - The maximum number of top entries to return.
 * @returns {Array<{userId: string, totalExp: number}>} Sorted array of top players.
 */
function getSortedLeaderboard(leaderboard, limit) {
    // Filter out internal keys like _lastResetDate and _dailyPoints.
    const userEntries = Object.entries(leaderboard).filter(([key]) => !key.startsWith('_'));

    return userEntries
        .map(([userId, totalExp]) => ({ userId, totalExp })) // Transform to an array of objects.
        .sort((a, b) => b.totalExp - a.totalExp) // Sort in descending order of total EXP.
        .slice(0, limit); // Get the top N entries based on the limit.
}

/**
 * Creates and returns a Discord EmbedBuilder instance for the leaderboard.
 * It resolves user IDs to display names for better readability.
 * @param {import('discord.js').Client} client The Discord client instance for fetching user/member data.
 * @param {import('discord.js').Guild} guild The guild (server) where the command was invoked, for fetching members.
 * @param {Array<{userId: string, totalExp: number}>} topPlayers - Sorted array of top players.
 * @param {string} resetInfo - Information about the last leaderboard reset (e.g., "Last reset: 2023-01-01").
 * @returns {Promise<EmbedBuilder>} The configured leaderboard embed.
 */
async function createLeaderboardEmbed(client, guild, topPlayers, resetInfo) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF) // Blue color for the embed.
        .setTitle('🏆 Raid Leaderboard 🏆')
        .setDescription(`Current Top 10 by Total EXP!\n\n${resetInfo}`)
        .setTimestamp(); // Adds a timestamp to the embed.

    if (topPlayers.length === 0) {
        // If no players are on the leaderboard, add a message indicating that.
        embed.addFields({ name: 'No Data Yet', value: 'The leaderboard is empty. Start earning some EXP!' });
    } else {
        // Iterate through the top players and add a field for each.
        for (let i = 0; i < topPlayers.length; i++) {
            const player = topPlayers[i];
            let userName = `<@${player.userId}>`; // Default to mention if resolution fails.
            try {
                // Attempt to fetch the guild member to get their display name (nickname).
                const member = await guild.members.fetch(player.userId);
                userName = member.displayName; // `displayName` prioritizes nickname over username.
            } catch (error) {
                // If member not found (e.g., left guild) or bot lacks permissions, fallback to username.
                try {
                    const user = await client.users.fetch(player.userId);
                    userName = user.username;
                } catch (userError) {
                    console.error(`Could not resolve user ID ${player.userId}:`, userError);
                    // Keep as mention tag if all else fails, as it's the most reliable fallback.
                }
            }
            embed.addFields({
                name: `${i + 1}. ${userName}`, // Rank and resolved user name.
                value: `${player.totalExp} EXP`, // Total EXP.
                inline: false // Each player gets a full line.
            });
        }
    }
    embed.setFooter({ text: 'Raid Helper Bot | Keep raiding for more points!' });
    return embed;
}

/**
 * Resets the leaderboard data, either fully or monthly.
 * A full reset clears all user points. A monthly reset sets all user points to 0
 * but keeps the user entries, and clears daily points.
 * @param {boolean} fullReset - If true, performs a full reset; otherwise, performs a monthly reset.
 */
async function resetLeaderboard(fullReset = false) {
    let leaderboard = await readLeaderboard(); // Get current leaderboard data.

    if (fullReset) {
        // For a full reset, create a brand new leaderboard object.
        leaderboard = {
            _lastResetDate: new Date().toISOString(), // Update last reset date.
            _dailyPoints: {} // Clear daily points entirely.
        };
        console.log('Full leaderboard reset initiated.');
    } else {
        // For a monthly reset, iterate through users and set their total EXP to 0.
        for (const userId in leaderboard) {
            if (!userId.startsWith('_')) { // Ensure we don't reset internal fields like `_lastResetDate`.
                leaderboard[userId] = 0;
            }
        }
        leaderboard._dailyPoints = {}; // Clear daily points for the new month.
        leaderboard._lastResetDate = new Date().toISOString(); // Update last reset date.
        console.log('Monthly leaderboard reset initiated.');
    }

    await writeLeaderboard(leaderboard); // Write the updated leaderboard back to file.
    leaderboardCache = null; // Invalidate the cache so next read fetches fresh data.
}

/**
 * Helper function to parse date arguments for the `!lbcheck` command.
 * It determines the start and end dates for the EXP lookup and a descriptive string.
 * Supports "today", "yesterday", "from X to Y" (day numbers), "X" (single day number), and "YYYY-MM-DD".
 * @param {string} content - The full message content after `!lbcheck`.
 * @param {import('discord.js').Message} message - The Discord message object, used to remove mentions from content.
 * @returns {{startDateISO: string, endDateISO: string, description: string, rawStartDate: Date, rawEndDate: Date} | {error: string}}
 * An object containing date information or an error message.
 */
function getDateRangeFromArgs(content, message) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize `today` to the start of the day.

    let startDate = null;
    let endDate = null;
    let description = '';

    // Remove the command prefix and any user mentions for cleaner parsing of date arguments.
    let cleanContent = content.toLowerCase().replace('!lbcheck', '').trim();
    message.mentions.users.forEach(user => {
        cleanContent = cleanContent.replace(new RegExp(`<@!?${user.id}>`, 'g'), '').trim();
    });

    const parts = cleanContent.split(/\s+/).filter(p => p !== ''); // Split by space, remove empty parts.

    if (parts.length === 0 || parts[0] === 'today') {
        startDate = new Date(today);
        endDate = new Date(today);
        description = 'Today';
    } else if (parts[0] === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1); // Set to the previous day.
        startDate = yesterday;
        endDate = yesterday;
        description = 'Yesterday';
    } else if (parts[0] === 'from' && parts[1] && parts[2] === 'to' && parts[3]) {
        // Example: `from 10 to 15` (day numbers within the current month).
        const startDay = parseInt(parts[1], 10);
        const endDay = parseInt(parts[3], 10);

        // Validate day numbers.
        if (isNaN(startDay) || isNaN(endDay) || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay > endDay) {
            return { error: 'Invalid date range. Use `from <day> to <day>` (e.g., `from 10 to 15`). Days must be between 1 and 31.' };
        }
        startDate = new Date(today.getFullYear(), today.getMonth(), startDay);
        endDate = new Date(today.getFullYear(), today.getMonth(), endDay);
        description = `From Day ${startDay} to Day ${endDay} of this month`;
    } else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
        // Example: `15` (single day number within the current month).
        const day = parseInt(parts[0], 10);
        if (isNaN(day) || day < 1 || day > 31) {
            return { error: 'Invalid day number. Use a number between 1 and 31.' };
        }
        startDate = new Date(today.getFullYear(), today.getMonth(), day);
        endDate = new Date(today.getFullYear(), today.getMonth(), day);
        description = `On Day ${day} of this month`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        // Example: `2023-11-20` (explicit date inastype-MM-DD format).
        const dateParts = parts[0].split('-');
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed in JavaScript Date.
        const day = parseInt(dateParts[2], 10);

        const parsedDate = new Date(year, month, day);
        // Basic validation: Check if the parsed date components match the input components,
        // which helps validate against invalid dates like Feb 30th.
        if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month || parsedDate.getDate() !== day) {
            return { error: 'Invalid date format. Use `YYYY-MM-DD`.' };
        }
        startDate = parsedDate;
        endDate = parsedDate;
        description = `On ${parts[0]}`;
    }
    else {
        // If no valid date argument is provided.
        return { error: 'Invalid usage. Use `!lbcheck [today|yesterday|<day>|from <start> to <end>|YYYY-MM-DD] [@user(s)]`' };
    }

    // Helper to format Date objects intoastype-MM-DD ISO strings.
    const formatToISO = (d) => d.toISOString().split('T')[0];

    return {
        startDateISO: formatToISO(startDate), // ISO string for the first day.
        endDateISO: formatToISO(endDate),     // ISO string for the last day.
        description: description,              // Human-readable description of the date range.
        rawStartDate: startDate,               // Full Date object for iteration.
        rawEndDate: endDate
    };
}


/**
 * Creates the `!lbcheck` embed and pagination buttons for a given page.
 * This function is used to dynamically update the leaderboard check message as users paginate.
 * @param {Object} sessionData - The session data for `!lbcheck` (containing current page, total pages, user data, date info).
 * @param {import('discord.js').Client} client - The Discord client instance (for potential future use, currently not directly used here).
 * @param {import('discord.js').Guild} guild - The guild where the command was invoked (for display name resolution).
 * @returns {Promise<{embeds: EmbedBuilder[], components: ActionRowBuilder[]}>} An object containing the embed and pagination buttons.
 */
async function createLbCheckResponse(sessionData, client, guild) {
    const { currentPage, totalPages, usersData, dateInfo } = sessionData;
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
            if (dateInfo.rawStartDate.getTime() === dateInfo.rawEndDate.getTime()) { // Single day check.
                descriptionContent += `• EXP Gained: ${userData.totalPointsForRange} EXP\n`;
            } else { // Date range check.
                descriptionContent += `• Total EXP in range: ${userData.totalPointsForRange} EXP\n`;
                // Only add daily breakdown if there's more than one day in the range and points exist.
                if (userData.dailyBreakdown.length > 1 && userData.totalPointsForRange > 0) {
                    descriptionContent += `  Breakdown:\n`;
                    const maxBreakdownLines = 5; // Limit the number of breakdown lines to prevent embed overflow.
                    if (userData.dailyBreakdown.length > maxBreakdownLines) {
                        // Display a few lines from the beginning and end if too many days.
                        descriptionContent += userData.dailyBreakdown.slice(0, Math.ceil(maxBreakdownLines / 2)).join('\n') + '\n';
                        descriptionContent += `  ... (${userData.dailyBreakdown.length - Math.floor(maxBreakdownLines / 2) - Math.ceil(maxBreakdownLines / 2)} more days) ...\n`;
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
                .setCustomId(`lbcheck_prev_${sessionData.originalRequesterId}_${sessionData.timestamp}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1), // Disable 'Previous' if on the first page.
            new ButtonBuilder()
                .setCustomId(`lbcheck_next_${sessionData.originalRequesterId}_${sessionData.timestamp}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages) // Disable 'Next' if on the last page.
        );

    return { embeds: [embed], components: [row] };
}


/**
 * Sets up event handlers for leaderboard functionalities.
 * This includes commands like `!leaderboard`, `!lbcheck`, `!addxp`, `!removexp`,
 * and `!resetlb` (with `!confirm`/`!cancel`).
 * @param {import('discord.js').Client} client - The Discord client instance.
 */
export function setupLeaderboardHandlers(client) {
    // --- Message Create Listener (for commands) ---
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return; // Ignore messages from bots.

        // Helper function to check admin status for the current message context.
        const checkAdmin = () => isAdmin(message);

        // --- Handle Leaderboard Command (`!leaderboard` / `!lb`) ---
        if (message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!lb') {
            // Ensure the command is used in a guild (server).
            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }
            try {
                const leaderboard = await getCachedLeaderboard(); // Get cached leaderboard data.
                const topPlayers = getSortedLeaderboard(leaderboard, 10); // Get top 10 players.
                const lastResetDate = leaderboard._lastResetDate ?
                    new Date(leaderboard._lastResetDate).toLocaleDateString() : 'Never';
                const resetInfo = `Last reset: ${lastResetDate}`;
                // Create and send the leaderboard embed.
                const embed = await createLeaderboardEmbed(client, message.guild, topPlayers, resetInfo);
                await message.channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Error displaying leaderboard:', error);
                await message.reply('Failed to retrieve leaderboard. Please try again later.');
            }
        }

        // --- Handle Leaderboard Check Command (`!lbcheck`) ---
        if (message.content.toLowerCase().startsWith('!lbcheck')) {
            // Ensure the command is used in a guild for member resolution.
            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            let targetUsers = [];
            if (message.mentions.users.size > 0) {
                // If specific users are mentioned, add them to targetUsers.
                message.mentions.users.forEach(user => targetUsers.push(user));
            }

            // Parse date arguments from the message content.
            const dateInfo = getDateRangeFromArgs(message.content, message);

            if (dateInfo.error) {
                return message.reply(dateInfo.error); // Reply with error if date parsing fails.
            }

            try {
                const leaderboard = await getCachedLeaderboard();

                // Determine the effective set of user IDs to check.
                let effectiveTargetUserIds = new Set();
                if (targetUsers.length > 0) { // If specific users were mentioned, check only them.
                    targetUsers.forEach(user => effectiveTargetUserIds.add(user.id));
                } else { // If no specific users, show all for specified date(s) who have points.
                    let currentDate = new Date(dateInfo.rawStartDate);
                    // Iterate through the date range and collect all user IDs with points for those days.
                    while (currentDate <= dateInfo.rawEndDate) {
                        const dateISO = currentDate.toISOString().split('T')[0];
                        const dailyData = leaderboard._dailyPoints && leaderboard._dailyPoints[dateISO];
                        if (dailyData) {
                            for (const userId in dailyData) {
                                if (!userId.startsWith('_')) { // Exclude internal daily points data.
                                    effectiveTargetUserIds.add(userId);
                                }
                            }
                        }
                        currentDate.setDate(currentDate.getDate() + 1); // Move to the next day.
                    }
                }

                if (effectiveTargetUserIds.size === 0) {
                    return message.reply(`No EXP recorded for anyone ${dateInfo.description}.`);
                }

                // Prepare an array of promises to fetch user display names and calculate points for each.
                const userPromises = Array.from(effectiveTargetUserIds).map(async userId => {
                    let userDisplayName = `<@${userId}>`; // Default to mention.
                    try {
                        const member = await message.guild.members.fetch(userId);
                        userDisplayName = member.displayName; // Use member's display name.
                    } catch (err) {
                        try {
                            const user = await client.users.fetch(userId);
                            userDisplayName = user.username; // Fallback to user's username.
                        } catch (fetchErr) {
                            console.error(`Could not resolve user ID ${userId}:`, fetchErr);
                        }
                    }

                    let userTotalPointsForRange = 0;
                    let dailyBreakdown = [];

                    let currentDate = new Date(dateInfo.rawStartDate);
                    while (currentDate <= dateInfo.rawEndDate) {
                        const dateISO = currentDate.toISOString().split('T')[0];
                        // Get daily points for the user on this specific date.
                        const dailyPoints = leaderboard._dailyPoints && leaderboard._dailyPoints[dateISO] && leaderboard._dailyPoints[dateISO][userId] || 0;
                        userTotalPointsForRange += dailyPoints;
                        // Add to daily breakdown, formatting the date.
                        dailyBreakdown.push(`\`${dateISO}\`: ${dailyPoints} EXP`);
                        currentDate.setDate(currentDate.getDate() + 1);
                    }

                    return {
                        id: userId,
                        displayName: userDisplayName,
                        totalPointsForRange: userTotalPointsForRange,
                        dailyBreakdown: dailyBreakdown,
                        overallTotal: leaderboard[userId] || 0 // Overall total from the main leaderboard.
                    };
                });

                const usersData = await Promise.all(userPromises); // Resolve all user data promises.

                // Filter out users with 0 points if no specific users were mentioned and it's a general lookup.
                const finalUsersData = (targetUsers.length === 0)
                    ? usersData.filter(u => u.totalPointsForRange > 0)
                    : usersData;

                if (finalUsersData.length === 0) {
                    return message.reply(`No EXP recorded for the specified users/date ${dateInfo.description}.`);
                }

                // Sort users by points gained in the specified range for better readability.
                finalUsersData.sort((a, b) => b.totalPointsForRange - a.totalPointsForRange);

                const USERS_PER_PAGE = 5;
                const totalPages = Math.ceil(finalUsersData.length / USERS_PER_PAGE);
                const initialPage = 1;

                const sessionTimestamp = Date.now(); // Unique ID for this session to prevent conflicts.

                const sessionData = {
                    currentPage: initialPage,
                    totalPages: totalPages,
                    usersData: finalUsersData, // Store all filtered and sorted user data.
                    dateInfo: dateInfo,
                    originalRequesterId: message.author.id,
                    timestamp: sessionTimestamp // Used in customId for uniqueness.
                };

                // Create the initial embed and components for the first page.
                const { embeds, components } = await createLbCheckResponse(sessionData, client, message.guild);
                const sentMessage = await message.channel.send({ embeds, components });

                // Store session data using the sent message's ID for pagination.
                activeLbCheckSessions.set(sentMessage.id, sessionData);

                // Set a timeout to clear the session and disable buttons after a period of inactivity.
                const timeoutId = setTimeout(async () => {
                    activeLbCheckSessions.delete(sentMessage.id); // Remove session from map.
                    try {
                        const expiredMessage = await sentMessage.channel.messages.fetch(sentMessage.id).catch(() => null);
                        if (expiredMessage) {
                            // Re-create buttons, but all disabled.
                            const disabledRow = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`lbcheck_prev_disabled_${sessionTimestamp}`)
                                        .setLabel('⬅️ Previous')
                                        .setStyle(ButtonStyle.Primary)
                                        .setDisabled(true),
                                    new ButtonBuilder()
                                        .setCustomId(`lbcheck_next_disabled_${sessionTimestamp}`)
                                        .setLabel('Next ➡️')
                                        .setStyle(ButtonStyle.Primary)
                                        .setDisabled(true)
                                );
                            await expiredMessage.edit({ components: [disabledRow] });
                            console.log(`!lbcheck session for message ${sentMessage.id} expired and buttons disabled.`);
                        }
                    } catch (err) {
                        console.error(`Error disabling buttons for expired !lbcheck session ${sentMessage.id}:`, err);
                    }
                }, LBCHECK_SESSION_LIFETIME_MS);
                sessionData.timeoutId = timeoutId; // Store timeout ID for potential clearing.

            } catch (error) {
                console.error('Error checking EXP:', error);
                await message.reply('Failed to check EXP. Please try again later.');
            }
            return;
        }

        // --- Handle Add XP Command (`!addxp`) ---
        if (message.content.toLowerCase().startsWith('!addxp')) {
            if (!checkAdmin()) {
                return; // Silently ignore if not an admin.
            }

            const mentions = message.mentions.users;
            const args = message.content.split(/\s+/);
            const amountIndex = args.length - 1; // Amount is always the last argument.

            // Validate command usage.
            if (mentions.size === 0 || isNaN(parseInt(args[amountIndex]))) {
                return message.reply('Usage: `!addxp @user1 [@user2 ...] <amount>`');
            }

            const amount = parseInt(args[amountIndex]);
            const addedToUsers = [];

            try {
                // Update leaderboard for each mentioned user.
                for (const [id, user] of mentions) {
                    await updateLeaderboard(id, amount);
                    addedToUsers.push(`<@${id}>`);
                }
                await message.reply(`Successfully added ${amount} EXP to ${addedToUsers.join(', ')}.`);
            } catch (error) {
                console.error('Error adding XP:', error);
                await message.reply('Failed to add XP. Please try again later.');
            }
        }

        // --- Handle Remove XP Command (`!removexp`) ---
        if (message.content.toLowerCase().startsWith('!removexp')) {
            if (!checkAdmin()) {
                return; // Silently ignore if not an admin.
            }

            const mentions = message.mentions.users;
            const args = message.content.split(/\s+/);
            const amountIndex = args.length - 1;

            // Validate command usage.
            if (mentions.size === 0 || isNaN(parseInt(args[amountIndex]))) {
                return message.reply('Usage: `!removexp @user1 [@user2 ...] <amount>`');
            }

            const amount = parseInt(args[amountIndex]);
            const removedFromUsers = [];

            try {
                // Update leaderboard for each mentioned user by subtracting points.
                for (const [id, user] of mentions) {
                    await updateLeaderboard(id, -amount); // Subtract points.
                    removedFromUsers.push(`<@${id}>`);
                }
                await message.reply(`Successfully removed ${amount} EXP from ${removedFromUsers.join(', ')}.`);
            } catch (error) {
                console.error('Error removing XP:', error);
                await message.reply('Failed to remove XP. Please try again later.');
            }
        }

        // --- Handle Reset Leaderboard Command (`!resetlb`) ---
        if (message.content.toLowerCase().startsWith('!resetlb')) {
            if (!checkAdmin()) {
                return; // Silently ignore if not an admin.
            }

            const args = message.content.toLowerCase().split(/\s+/);
            const fullReset = args.includes('all'); // Check for '!resetlb all' for a full reset.

            // Store the pending reset request, awaiting confirmation.
            pendingResets.set(message.author.id, {
                timestamp: Date.now(),
                fullReset: fullReset,
                channelId: message.channel.id // Store channel ID to ensure confirmation is in the same channel.
            });

            await message.reply({
                content: `Are you sure you want to ${fullReset ? '**fully** ' : ''}reset the leaderboard? This action is irreversible. Type \`!confirm\` in this channel within ${RESET_CONFIRMATION_TIMEOUT_MS / 1000} seconds to proceed, or \`!cancel\` to abort.`,
                ephemeral: true // Make the confirmation message ephemeral (only visible to the user).
            });

            // Set a timeout to clear the pending request if not confirmed within the duration.
            setTimeout(() => {
                const currentPending = pendingResets.get(message.author.id);
                // Check if the pending request is still active and from the same channel, and not yet expired.
                if (currentPending && currentPending.channelId === message.channel.id && Date.now() - currentPending.timestamp < RESET_CONFIRMATION_TIMEOUT_MS) {
                    pendingResets.delete(message.author.id); // Remove the pending request.
                    // Inform the user via DM that their confirmation timed out.
                    message.author.send(`Your leaderboard reset confirmation in <#${message.channel.id}> has expired. Please try \`!resetlb\` again if you wish to proceed.`).catch(err => console.error(`Failed to send expiration message to user ${message.author.id}:`, err));
                }
            }, RESET_CONFIRMATION_TIMEOUT_MS);

            return; // No further processing here, waiting for `!confirm` or `!cancel`.
        }

        // --- Handle Confirmation Command (`!confirm`) ---
        if (message.content.toLowerCase() === '!confirm') {
            const pending = pendingResets.get(message.author.id);

            // Validate if there's a valid pending reset request for this user in this channel.
            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                if (!checkAdmin()) {
                    return; // Silently ignore if not an admin.
                }
                return message.reply({ content: 'No pending leaderboard reset confirmation found or it has expired. Please use `!resetlb` first.', ephemeral: true });
            }

            if (!checkAdmin()) {
                pendingResets.delete(message.author.id); // Clear pending if non-admin tries to confirm.
                return; // Silently ignore if not an admin.
            }

            pendingResets.delete(message.author.id); // Clear the pending request after successful validation.

            try {
                await resetLeaderboard(pending.fullReset); // Perform the reset.
                await message.reply({ content: `Leaderboard ${pending.fullReset ? 'fully' : 'monthly'} reset successfully!`, ephemeral: true });
            } catch (error) {
                console.error('Error resetting leaderboard:', error);
                await message.reply({ content: 'Failed to reset leaderboard. Please try again later.', ephemeral: true });
            }
            return;
        }

        // --- Handle Cancellation Command (`!cancel`) ---
        if (message.content.toLowerCase() === '!cancel') {
            const pending = pendingResets.get(message.author.id);

            // Validate if there's a valid pending reset request for this user in this channel.
            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                if (!checkAdmin()) {
                    return; // Silently ignore if not an admin.
                }
                return message.reply({ content: 'No pending leaderboard reset to cancel.', ephemeral: true });
            }

            if (!checkAdmin()) {
                pendingResets.delete(message.author.id); // Clear pending if non-admin tries to cancel.
                return; // Silently ignore if not an admin.
            }

            pendingResets.delete(message.author.id); // Clear the pending request.
            await message.reply({ content: 'Leaderboard reset cancelled.', ephemeral: true });
            return;
        }

        // --- Handle `!pretendnewmonth` Command (for testing monthly reset) ---
        // This command is intended for testing and should be removed or restricted in a production bot.
        if (message.content.toLowerCase() === '!pretendnewmonth') {
            // Only allow users with MODERATOR_ROLE_ID or OFFICER_ROLE_ID to use this command for safety.
            if (!checkAdmin()) {
                return;
            }

            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            try {
                await message.reply({ content: 'Simulating monthly leaderboard reset and announcement...', ephemeral: true });

                const raidChannel = await client.channels.fetch(RAID_CHANNEL_ID);
                if (raidChannel && raidChannel.isTextBased()) {
                    // Get the current leaderboard before the reset for the announcement.
                    const oldLeaderboard = await getCachedLeaderboard();
                    const topPlayersBeforeReset = getSortedLeaderboard(oldLeaderboard, 10);
                    const guild = message.guild;

                    if (guild) {
                        // Create and send the "final" leaderboard embed for the previous month.
                        const embed = await createLeaderboardEmbed(client, guild, topPlayersBeforeReset, "Final Leaderboard for Last Month (Simulated Reset)");
                        await raidChannel.send({ embeds: [embed] });
                        // Announce the simulated reset.
                        await raidChannel.send('📈 The monthly leaderboard has been automatically reset (simulated)! Good luck this month, raiders!');
                    } else {
                        console.warn('No guild context to create leaderboard embed for simulated announcement.');
                    }

                    // Perform the actual monthly reset (non-full reset).
                    await resetLeaderboard(false);
                    console.log('Simulated monthly leaderboard reset completed.');

                    // Optionally, send a new, empty leaderboard (or current state after reset)
                    // You might want to display the *new* empty/fresh leaderboard after reset for confirmation
                    const newLeaderboard = await getCachedLeaderboard();
                    const newTopPlayers = getSortedLeaderboard(newLeaderboard, 10);
                    const newResetInfo = `Last reset: ${new Date().toLocaleDateString()}`;
                    const newEmbed = await createLeaderboardEmbed(client, message.guild, newTopPlayers, newResetInfo);
                    await raidChannel.send({ content: "Here's the new leaderboard after the simulated reset:", embeds: [newEmbed] });

                } else {
                    console.warn(`RAID_CHANNEL_ID (${RAID_CHANNEL_ID}) is not a text channel or could not be fetched for simulated reset.`);
                    await message.reply({ content: `Failed to find raid channel (<#${RAID_CHANNEL_ID}>) for simulated announcement.`, ephemeral: true });
                }
            } catch (error) {
                console.error('Error simulating monthly reset:', error);
                await message.reply('Failed to simulate monthly reset. Please check bot permissions and channel ID.');
            }
        }

        // --- Handle `!Getlb` Command ---
        if (message.content.toLowerCase() === '!getlb') {
            if (!checkAdmin()) {
                return; // Silently ignore if not an admin.
            }

            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            try {
                // Read the leaderboard file directly.
                const leaderboardFileContent = await fs.readFile(LEADERBOARD_FILE, 'utf8');

                // Create a buffer from the file content to send as an attachment.
                const fileBuffer = Buffer.from(leaderboardFileContent, 'utf8');

                // Send the file as an attachment.
                await message.reply({
                    content: 'Here is the current `leaderboard.json` file.',
                    files: [{
                        attachment: fileBuffer,
                        name: 'leaderboard.json'
                    }],
                    ephemeral: true // Send as an ephemeral message for privacy/cleanliness.
                });
                console.log(`Leaderboard file sent to ${message.author.tag} in channel ${message.channel.name}.`);
            } catch (error) {
                console.error('Error sending leaderboard file:', error);
                await message.reply({ content: 'Failed to send the leaderboard file. Please check bot permissions and file path.', ephemeral: true });
            }
            return;
        }
    });

    // --- Interaction Create Listener (for !lbcheck pagination buttons) ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return; // Only handle button interactions here.

        // Check if the button customId starts with 'lbcheck_'.
        if (interaction.customId.startsWith('lbcheck_')) {
            // Extract the action, requesterId, and timestamp from the customId.
            // Custom ID format: `lbcheck_prev_{requesterId}_{timestamp}` or `lbcheck_next_{requesterId}_{timestamp}`
            const [, action, originalRequesterId, timestampStr] = interaction.customId.split('_');
            const sessionTimestamp = parseInt(timestampStr, 10);
            const sessionKey = interaction.message.id; // Use the message ID as the session key.

            const sessionData = activeLbCheckSessions.get(sessionKey);

            // If session not found or timed out, inform the user and disable buttons.
            if (!sessionData || Date.now() - sessionData.timestamp > LBCHECK_SESSION_LIFETIME_MS) {
                // If it somehow passed the map check but is too old, clean up
                if (sessionData && sessionData.timeoutId) {
                    clearTimeout(sessionData.timeoutId); // Clear any pending timeout
                }
                activeLbCheckSessions.delete(sessionKey);

                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('expired_prev').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('expired_next').setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                await interaction.update({ components: [disabledRow] }).catch(e => console.error("Error updating expired lbcheck message:", e));
                return interaction.followUp({ content: 'This leaderboard session has expired. Please run `!lbcheck` again.', ephemeral: true });
            }

            // Ensure only the original requester can interact with their pagination.
            if (interaction.user.id !== sessionData.originalRequesterId) {
                return interaction.reply({ content: 'You can only navigate your own leaderboard checks!', ephemeral: true });
            }

            // Defer the update to prevent interaction failed error.
            await interaction.deferUpdate();

            // Clear the existing timeout and set a new one to extend session lifetime.
            clearTimeout(sessionData.timeoutId);
            sessionData.timeoutId = setTimeout(async () => {
                activeLbCheckSessions.delete(sessionKey);
                try {
                    const expiredMessage = await interaction.channel.messages.fetch(sessionKey).catch(() => null);
                    if (expiredMessage) {
                        const disabledRow = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder().setCustomId(`lbcheck_prev_disabled_${sessionTimestamp}`).setLabel('⬅️ Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
                                new ButtonBuilder().setCustomId(`lbcheck_next_disabled_${sessionTimestamp}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(true)
                            );
                        await expiredMessage.edit({ components: [disabledRow] });
                        console.log(`!lbcheck session for message ${sessionKey} expired and buttons disabled.`);
                    }
                } catch (err) {
                    console.error(`Error disabling buttons for expired !lbcheck session ${sessionKey}:`, err);
                }
            }, LBCHECK_SESSION_LIFETIME_MS);


            if (action === 'next') {
                sessionData.currentPage++;
            } else if (action === 'prev') {
                sessionData.currentPage--;
            }

            // Ensure current page is within bounds.
            sessionData.currentPage = Math.max(1, Math.min(sessionData.currentPage, sessionData.totalPages));

            // Update the session data in the map.
            activeLbCheckSessions.set(sessionKey, sessionData);

            // Re-render the embed and components.
            const { embeds, components } = await createLbCheckResponse(sessionData, client, interaction.guild);
            await interaction.editReply({ embeds, components });
        }
    });


    // --- Monthly Leaderboard Reset Logic (Scheduled Task) ---
    // This is a simple in-memory check. For production, consider a more robust scheduler (e.g., cron job or a dedicated hosted service).
    setInterval(async () => {
        try {
            const leaderboard = await readLeaderboard(); // Read directly to check reset date.
            const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
            const now = new Date();

            // Check if it's a new month (or if lastReset is null/invalid for initial run).
            // This also handles cases where bot was offline during a reset window.
            if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
                console.log('Performing automatic monthly leaderboard reset...');

                // Announce the reset in the RAID_CHANNEL_ID.
                try {
                    const raidChannel = await client.channels.fetch(RAID_CHANNEL_ID);
                    if (raidChannel && raidChannel.isTextBased()) {
                        // Fetch the top players just before reset for the announcement.
                        const oldLeaderboard = await getCachedLeaderboard(); // Get the state BEFORE reset.
                        const topPlayersBeforeReset = getSortedLeaderboard(oldLeaderboard, 10);
                        // For a scheduled task, you might need to fetch a relevant guild or assume one if the bot is in only one guild.
                        // For simplicity, we'll get the first guild the bot is in from its cache.
                        const guild = client.guilds.cache.first();
                        if (guild) {
                            const embed = await createLeaderboardEmbed(client, guild, topPlayersBeforeReset, "Final Leaderboard for Last Month"); // Pass guild here.
                            await raidChannel.send({ embeds: [embed] });
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

                // Perform a monthly reset (not full reset) AFTER sending the embed.
                await resetLeaderboard(false);
            }
        } catch (error) {
            console.error('Error in monthly leaderboard reset check:', error);
        }
    }, 24 * 60 * 60 * 1000); // Check once every 24 hours.
}
