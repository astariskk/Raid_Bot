// handlers/leaderboardHandler.js
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'; // Added ActionRowBuilder, ButtonBuilder, ButtonStyle
import { readLeaderboard, writeLeaderboard, updateLeaderboard } from '../utils/fileOps.js';
// Import RAID_CHANNEL_ID along with other constants
import { LEADERBOARD_FILE, MODERATOR_ROLE_ID, OFFICER_ROLE_ID,RAID_CHANNEL_ID } from '../config/constants.js'; 

const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes for leaderboard cache
let leaderboardCache = null;
let lastCacheTime = 0;

// Store pending reset confirmations: Map<userId, { timestamp: Date, fullReset: boolean, channelId: string }>
const pendingResets = new Map();
const RESET_CONFIRMATION_TIMEOUT_MS = 30 * 1000; // 30 seconds

// New: Store active !lbcheck sessions for pagination
// Map<messageId (of the bot's sent embed), { currentPage: number, totalPages: number, usersData: Array, dateInfo: Object, originalRequesterId: string, timeoutId: NodeJS.Timeout }>
const activeLbCheckSessions = new Map(); 
const LBCHECK_SESSION_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes for !lbcheck pagination session

/**
 * Checks if the message author has the designated MODERATOR_ROLE_ID.
 * @param {import('discord.js').Message} message The Discord message object.
 * @returns {boolean} True if the author has the MODERATOR_ROLE_ID, false otherwise.
 */
function isAdmin(message) {
    // Now exclusively checks for the MODERATOR_ROLE_ID
    return message.member && (message.member.roles.cache.has(MODERATOR_ROLE_ID) || message.member.roles.cache.has(OFFICER_ROLE_ID));
}

/**
 * Fetches the current leaderboard data, utilizing a cache.
 * @returns {Promise<Object>} The leaderboard data.
 */
async function getCachedLeaderboard() {
    const now = Date.now();
    if (leaderboardCache && (now - lastCacheTime < CACHE_LIFETIME_MS)) {
        return leaderboardCache;
    }
    leaderboardCache = await readLeaderboard();
    lastCacheTime = now;
    return leaderboardCache;
}

/**
 * Sorts leaderboard data and returns top N entries.
 * @param {Object} leaderboard - The raw leaderboard object.
 * @param {number} limit - The number of top entries to return.
 * @returns {Array<{userId: string, totalExp: number}>} Sorted array of top players.
*/
function getSortedLeaderboard(leaderboard, limit) {
    // Filter out internal keys like _lastResetDate and _dailyPoints
    const userEntries = Object.entries(leaderboard).filter(([key]) => !key.startsWith('_'));

    return userEntries
        .map(([userId, totalExp]) => ({ userId, totalExp }))
        .sort((a, b) => b.totalExp - a.totalExp) // Sort descending by totalExp
        .slice(0, limit); // Get top N
}

/**
 * Creates and returns the Leaderboard Embed.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {import('discord.js').Guild} guild The guild where the command was invoked.
 * @param {Array<{userId: string, totalExp: number}>} topPlayers - Sorted array of top players.
 * @param {string} resetInfo - Information about the last reset.
 * @returns {Promise<EmbedBuilder>} The leaderboard embed.
 */
async function createLeaderboardEmbed(client, guild, topPlayers, resetInfo) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🏆 Raid Leaderboard 🏆')
        .setDescription(`Current Top 10 by Total EXP!\n\n${resetInfo}`)
        .setTimestamp();

    if (topPlayers.length === 0) {
        embed.addFields({ name: 'No Data Yet', value: 'The leaderboard is empty. Start earning some EXP!' });
    } else {
        for (let i = 0; i < topPlayers.length; i++) {
            const player = topPlayers[i];
            let userName = `<@${player.userId}>`; // Default to mention if resolution fails
            try {
                // Fetch the guild member to get their display name (nickname)
                const member = await guild.members.fetch(player.userId);
                userName = member.displayName; // Use displayName which prioritizes nickname
            } catch (error) {
                // If member not found (e.g., left guild) or bot lacks permissions, fallback to username or mention
                try {
                    const user = await client.users.fetch(player.userId);
                    userName = user.username;
                } catch (userError) {
                    console.error(`Could not resolve user ID ${player.userId}:`, userError);
                    // Keep as mention tag if all else fails
                }
            }
            embed.addFields({
                name: `${i + 1}. ${userName}`,
                value: `${player.totalExp} EXP`,
                inline: false
            });
        }
    }
    embed.setFooter({ text: 'Raid Helper Bot | Keep raiding for more points!' });
    return embed;
}

/**
 * Resets the leaderboard data.
 * @param {boolean} fullReset - If true, resets all user points; otherwise, only clears daily points.
 */
async function resetLeaderboard(fullReset = false) {
    let leaderboard = await readLeaderboard();

    if (fullReset) {
        // Create a new leaderboard object, keeping only meta-info if needed for future
        leaderboard = {
            _lastResetDate: new Date().toISOString(),
            _dailyPoints: {}
        };
        console.log('Full leaderboard reset initiated.');
    } else {
        // Monthly reset: clear points, but keep existing users (set points to 0)
        for (const userId in leaderboard) {
            if (!userId.startsWith('_')) { // Don't reset internal fields
                leaderboard[userId] = 0;
            }
        }
        leaderboard._dailyPoints = {}; // Clear daily points
        leaderboard._lastResetDate = new Date().toISOString();
        console.log('Monthly leaderboard reset initiated.');
    }

    await writeLeaderboard(leaderboard);
    leaderboardCache = null; // Invalidate cache
}

/**
 * Helper function to parse date arguments for !lbcheck.
 * It determines the start/end dates and a description string.
 * @param {string} content - The full message content after `!lbcheck`.
 * @param {import('discord.js').Message} message - The Discord message object.
 * @returns {{startDateISO: string, endDateISO: string, description: string, rawStartDate: Date, rawEndDate: Date} | {error: string}}
 */
function getDateRangeFromArgs(content, message) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    let startDate = null;
    let endDate = null;
    let description = '';

    // Remove the command prefix and any mentions for cleaner parsing of date args
    let cleanContent = content.toLowerCase().replace('!lbcheck', '').trim();
    message.mentions.users.forEach(user => {
        cleanContent = cleanContent.replace(new RegExp(`<@!?${user.id}>`, 'g'), '').trim();
    });
    
    const parts = cleanContent.split(/\s+/).filter(p => p !== ''); // Split by space, remove empty parts

    if (parts.length === 0 || parts[0] === 'today') {
        startDate = new Date(today);
        endDate = new Date(today);
        description = 'Today';
    } else if (parts[0] === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        startDate = yesterday;
        endDate = yesterday;
        description = 'Yesterday';
    } else if (parts[0] === 'from' && parts[1] && parts[2] === 'to' && parts[3]) {
        // !lbcheck from X to Y (day numbers)
        const startDay = parseInt(parts[1], 10);
        const endDay = parseInt(parts[3], 10);

        if (isNaN(startDay) || isNaN(endDay) || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay > endDay) {
            return { error: 'Invalid date range. Use `from <day> to <day>` (e.g., `from 10 to 15`). Days must be between 1 and 31.' };
        }
        startDate = new Date(today.getFullYear(), today.getMonth(), startDay);
        endDate = new Date(today.getFullYear(), today.getMonth(), endDay);
        description = `From Day ${startDay} to Day ${endDay} of this month`;
    } else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
        // !lbcheck X (single day number)
        const day = parseInt(parts[0], 10);
        if (isNaN(day) || day < 1 || day > 31) {
            return { error: 'Invalid day number. Use a number between 1 and 31.' };
        }
        startDate = new Date(today.getFullYear(), today.getMonth(), day);
        endDate = new Date(today.getFullYear(), today.getMonth(), day);
        description = `On Day ${day} of this month`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        // AllowYYYY-MM-DD for explicit date
        const dateParts = parts[0].split('-');
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(dateParts[2], 10);

        const parsedDate = new Date(year, month, day);
        // Basic validation for date existence
        if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month || parsedDate.getDate() !== day) {
            return { error: 'Invalid date format. Use `YYYY-MM-DD`.' };
        }
        startDate = parsedDate;
        endDate = parsedDate;
        description = `On ${parts[0]}`;
    }
    else {
        return { error: 'Invalid usage. Use `!lbcheck [today|yesterday|<day>|from <start> to <end>] [@user(s)]`' };
    }

    // Normalize dates to ISO string for lookup if needed, but primarily use Date objects for iteration
    const formatToISO = (d) => d.toISOString().split('T')[0];

    return {
        startDateISO: formatToISO(startDate), // ISO string for the first day
        endDateISO: formatToISO(endDate),     // ISO string for the last day
        description: description,
        rawStartDate: startDate, // Keep full Date objects for iteration
        rawEndDate: endDate
    };
}


/**
 * Creates the !lbcheck embed and buttons for a given page.
 * @param {Object} sessionData - The session data for !lbcheck.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {import('discord.js').Guild} guild - The guild where the command was invoked.
 * @returns {Promise<{embeds: EmbedBuilder[], components: ActionRowBuilder[]}>}
 */
async function createLbCheckResponse(sessionData, client, guild) {
    const { currentPage, totalPages, usersData, dateInfo } = sessionData;
    const USERS_PER_PAGE = 5;

    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, usersData.length);
    const usersOnPage = usersData.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`📊 EXP Check ${dateInfo.description} 📊`)
        .setTimestamp()
        .setFooter({ text: `Page ${currentPage}/${totalPages} | Raid Helper Bot | EXP Breakdown` });

    let descriptionContent = '';

    if (usersOnPage.length === 0) {
        descriptionContent = 'No EXP data found for this page.';
    } else {
        for (const userData of usersOnPage) {
            descriptionContent += `**${userData.displayName}**\n`;
            if (dateInfo.rawStartDate.getTime() === dateInfo.rawEndDate.getTime()) { // Single day
                descriptionContent += `• EXP Gained: ${userData.totalPointsForRange} EXP\n`;
            } else { // Date range
                descriptionContent += `• Total EXP in range: ${userData.totalPointsForRange} EXP\n`;
                // Only add breakdown if there's more than one day in the range and points exist
                if (userData.dailyBreakdown.length > 1 && userData.totalPointsForRange > 0) {
                    descriptionContent += `  Breakdown:\n`;
                    // Limit breakdown lines to prevent embed overflow
                    const maxBreakdownLines = 5; 
                    if (userData.dailyBreakdown.length > maxBreakdownLines) {
                        descriptionContent += userData.dailyBreakdown.slice(0, maxBreakdownLines / 2).join('\n') + '\n';
                        descriptionContent += `  ... (${userData.dailyBreakdown.length - maxBreakdownLines} more days) ...\n`;
                        descriptionContent += userData.dailyBreakdown.slice(-maxBreakdownLines / 2).join('\n') + '\n';
                    } else {
                        descriptionContent += userData.dailyBreakdown.join('\n') + '\n';
                    }
                }
            }
            descriptionContent += `• Overall Total EXP: ${userData.overallTotal} EXP\n\n`;
        }
    }
    embed.setDescription(descriptionContent);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`lbcheck_prev_${sessionData.originalRequesterId}_${sessionData.timestamp}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lbcheck_next_${sessionData.originalRequesterId}_${sessionData.timestamp}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages)
        );

    return { embeds: [embed], components: [row] };
}


/**
 * Sets up event handlers for leaderboard functionalities.
 * @param {import('discord.js').Client} client - The Discord client instance.
 */
export function setupLeaderboardHandlers(client) {
    // --- Message Create Listener (for commands) ---
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return; // Ignore messages from bots

        // Function to check if the user is an admin (moved inside to have access to message)
        const checkAdmin = () => isAdmin(message);

        // --- Handle Leaderboard Command (!leaderboard / !lb) ---
        if (message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!lb') {
            // Ensure the command is used in a guild
            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }
            try {
                const leaderboard = await getCachedLeaderboard();
                const topPlayers = getSortedLeaderboard(leaderboard, 10);
                const lastResetDate = leaderboard._lastResetDate ?
                    new Date(leaderboard._lastResetDate).toLocaleDateString() : 'Never';
                const resetInfo = `Last reset: ${lastResetDate}`;
                // Pass client and guild to createLeaderboardEmbed
                const embed = await createLeaderboardEmbed(client, message.guild, topPlayers, resetInfo);
                await message.channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Error displaying leaderboard:', error);
                await message.reply('Failed to retrieve leaderboard. Please try again later.');
            }
        }

        // --- Handle Leaderboard Check Command (!lbcheck) ---
        if (message.content.toLowerCase().startsWith('!lbcheck')) {
            // Ensure the command is used in a guild for member resolution
            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            let targetUsers = [];
            if (message.mentions.users.size > 0) {
                message.mentions.users.forEach(user => targetUsers.push(user));
            }

            const dateInfo = getDateRangeFromArgs(message.content, message); // Pass full message content for parsing

            if (dateInfo.error) {
                return message.reply(dateInfo.error);
            }

            try {
                const leaderboard = await getCachedLeaderboard();
                
                // Determine effective target users for the query
                let effectiveTargetUserIds = new Set();
                if (targetUsers.length > 0) { // Specific users were mentioned
                    targetUsers.forEach(user => effectiveTargetUserIds.add(user.id));
                } else { // No specific users mentioned, show all for specified date(s) who have points
                    let currentDate = new Date(dateInfo.rawStartDate);
                    while (currentDate <= dateInfo.rawEndDate) {
                        const dateISO = currentDate.toISOString().split('T')[0];
                        const dailyData = leaderboard._dailyPoints && leaderboard._dailyPoints[dateISO];
                        if (dailyData) {
                            for (const userId in dailyData) {
                                if (!userId.startsWith('_')) {
                                    effectiveTargetUserIds.add(userId);
                                }
                            }
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                if (effectiveTargetUserIds.size === 0) {
                    return message.reply(`No EXP recorded for anyone ${dateInfo.description}.`);
                }

                // Prepare an array of promises for user resolution and point calculation
                const userPromises = Array.from(effectiveTargetUserIds).map(async userId => {
                    let userDisplayName = `<@${userId}>`;
                    try {
                        const member = await message.guild.members.fetch(userId);
                        userDisplayName = member.displayName;
                    } catch (err) {
                        try {
                            const user = await client.users.fetch(userId);
                            userDisplayName = user.username;
                        } catch (fetchErr) {
                            console.error(`Could not resolve user ID ${userId}:`, fetchErr);
                        }
                    }

                    let userTotalPointsForRange = 0;
                    let dailyBreakdown = [];

                    let currentDate = new Date(dateInfo.rawStartDate);
                    while (currentDate <= dateInfo.rawEndDate) {
                        const dateISO = currentDate.toISOString().split('T')[0];
                        const dailyPoints = leaderboard._dailyPoints && leaderboard._dailyPoints[dateISO] && leaderboard._dailyPoints[dateISO][userId] || 0;
                        userTotalPointsForRange += dailyPoints;
                        dailyBreakdown.push(`\`${dateISO}\`: ${dailyPoints} EXP`);
                        currentDate.setDate(currentDate.getDate() + 1);
                    }

                    return {
                        id: userId,
                        displayName: userDisplayName,
                        totalPointsForRange: userTotalPointsForRange,
                        dailyBreakdown: dailyBreakdown,
                        overallTotal: leaderboard[userId] || 0
                    };
                });

                const usersData = await Promise.all(userPromises);

                // Filter out users with 0 points if no specific users were mentioned and it's a general lookup
                // (This prevents showing everyone if they have no points)
                const finalUsersData = (targetUsers.length === 0) 
                    ? usersData.filter(u => u.totalPointsForRange > 0)
                    : usersData;

                if (finalUsersData.length === 0) {
                    return message.reply(`No EXP recorded for the specified users/date ${dateInfo.description}.`);
                }

                // Sort users by points gained in the specified range for better readability
                finalUsersData.sort((a, b) => b.totalPointsForRange - a.totalPointsForRange);

                const USERS_PER_PAGE = 5;
                const totalPages = Math.ceil(finalUsersData.length / USERS_PER_PAGE);
                const initialPage = 1;

                const sessionTimestamp = Date.now(); // Unique ID for this session

                const sessionData = {
                    currentPage: initialPage,
                    totalPages: totalPages,
                    usersData: finalUsersData, // Store all data
                    dateInfo: dateInfo,
                    originalRequesterId: message.author.id,
                    timestamp: sessionTimestamp // Used in customId for uniqueness
                };
                
                const { embeds, components } = await createLbCheckResponse(sessionData, client, message.guild);
                const sentMessage = await message.channel.send({ embeds, components });

                // Store session data using the sent message's ID
                activeLbCheckSessions.set(sentMessage.id, sessionData);

                // Set a timeout to clear the session and disable buttons
                const timeoutId = setTimeout(async () => {
                    activeLbCheckSessions.delete(sentMessage.id);
                    try {
                        // Re-fetch message to ensure it's not deleted already
                        const expiredMessage = await sentMessage.channel.messages.fetch(sentMessage.id).catch(() => null);
                        if (expiredMessage) {
                            // Re-create buttons, but all disabled
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
                sessionData.timeoutId = timeoutId; // Store timeout ID for potential clearing

            } catch (error) {
                console.error('Error checking EXP:', error);
                await message.reply('Failed to check EXP. Please try again later.');
            }
            return;
        }

        // --- Handle Add XP Command ---
        if (message.content.toLowerCase().startsWith('!addxp')) {
            if (!checkAdmin()) {
                // Removed reply for non-moderators
                return; 
            }

            const mentions = message.mentions.users;
            const args = message.content.split(/\s+/);
            const amountIndex = args.length - 1; // Amount is always the last argument

            // Check if there are mentions and the last argument is a number
            if (mentions.size === 0 || isNaN(parseInt(args[amountIndex]))) {
                return message.reply('Usage: `!addxp @user1 [@user2 ...] <amount>`');
            }

            const amount = parseInt(args[amountIndex]);
            const addedToUsers = [];

            try {
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

        // --- Handle Remove XP Command ---
        if (message.content.toLowerCase().startsWith('!removexp')) {
            if (!checkAdmin()) {
                // Removed reply for non-moderators
                return;
            }

            const mentions = message.mentions.users;
            const args = message.content.split(/\s+/);
            const amountIndex = args.length - 1; // Amount is always the last argument

            // Check if there are mentions and the last argument is a number
            if (mentions.size === 0 || isNaN(parseInt(args[amountIndex]))) {
                return message.reply('Usage: `!removexp @user1 [@user2 ...] <amount>`');
            }

            const amount = parseInt(args[amountIndex]);
            const removedFromUsers = [];

            try {
                for (const [id, user] of mentions) {
                    await updateLeaderboard(id, -amount); // Subtract points
                    removedFromUsers.push(`<@${id}>`);
                }
                await message.reply(`Successfully removed ${amount} EXP from ${removedFromUsers.join(', ')}.`);
            } catch (error) {
                console.error('Error removing XP:', error);
                await message.reply('Failed to remove XP. Please try again later.');
            }
        }

        // --- Handle Reset Command (!resetlb) ---
        if (message.content.toLowerCase().startsWith('!resetlb')) {
            if (!checkAdmin()) {
                return; // Removed ephemeral reply for non-moderators
            }

            const args = message.content.toLowerCase().split(/\s+/);
            const fullReset = args.includes('all'); // Check for '!resetlb all'

            // Store the pending reset request
            pendingResets.set(message.author.id, {
                timestamp: Date.now(),
                fullReset: fullReset,
                channelId: message.channel.id // Store channel ID for later context
            });

            await message.reply({
                content: `Are you sure you want to ${fullReset ? '**fully** ' : ''}reset the leaderboard? This action is irreversible. Type \`!confirm\` in this channel within ${RESET_CONFIRMATION_TIMEOUT_MS / 1000} seconds to proceed, or \`!cancel\` to abort.`,
                ephemeral: true
            });

            // Set a timeout to clear the pending request if not confirmed
            setTimeout(() => {
                const currentPending = pendingResets.get(message.author.id);
                if (currentPending && currentPending.channelId === message.channel.id && Date.now() - currentPending.timestamp < RESET_CONFIRMATION_TIMEOUT_MS) {
                    pendingResets.delete(message.author.id);
                    message.author.send(`Your leaderboard reset confirmation in <#${message.channel.id}> has expired. Please try \`!resetlb\` again if you wish to proceed.`).catch(err => console.error(`Failed to send expiration message to user ${message.author.id}:`, err));
                }
            }, RESET_CONFIRMATION_TIMEOUT_MS);

            return; // No further processing here, waiting for !confirm or !cancel
        }

        // --- Handle Confirmation Command (!confirm) ---
        if (message.content.toLowerCase() === '!confirm') {
            const pending = pendingResets.get(message.author.id);

            // Check if there's a pending reset for this user and if the command is in the same channel and not expired
            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                 // Check admin here to prevent non-admins from getting "no pending reset" and then "no perm"
                if (!checkAdmin()) { 
                    return; // Removed ephemeral reply for non-moderators
                }
                return message.reply({ content: 'No pending leaderboard reset confirmation found or it has expired. Please use `!resetlb` first.', ephemeral: true });
            }

            if (!checkAdmin()) { 
                pendingResets.delete(message.author.id); 
                return; // Removed ephemeral reply for non-moderators
            }

            pendingResets.delete(message.author.id); // Clear the pending request

            try {
                await resetLeaderboard(pending.fullReset);
                await message.reply({ content: `Leaderboard ${pending.fullReset ? 'fully' : 'monthly'} reset successfully!`, ephemeral: true });
            } catch (error) {
                console.error('Error resetting leaderboard:', error);
                await message.reply({ content: 'Failed to reset leaderboard. Please try again later.', ephemeral: true });
            }
            return;
        }

        // --- Handle Cancellation Command (!cancel) ---
        if (message.content.toLowerCase() === '!cancel') {
            const pending = pendingResets.get(message.author.id);

            // Check if there's a pending reset for this user and if the command is in the same channel and not expired
            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                if (!checkAdmin()) { 
                    return; // Removed ephemeral reply for non-moderators
                }
                return message.reply({ content: 'No pending leaderboard reset to cancel.', ephemeral: true });
            }

            if (!checkAdmin()) { 
                pendingResets.delete(message.author.id); 
                return; // Removed ephemeral reply for non-moderators
            }

            pendingResets.delete(message.author.id); // Clear the pending request
            await message.reply({ content: 'Leaderboard reset cancelled.', ephemeral: true });
            return;
        }

        // --- Handle !pretendnewmonth Command --- //remove this code later
        if (message.content.toLowerCase() === '!pretendnewmonth') {
            if (!checkAdmin() || !message.member.roles.cache.has(MODERATOR_ROLE_ID)) {
                return; // Only allow administrators to use this command
            }

            if (!message.guild) {
                return message.reply("This command can only be used in a server.");
            }

            try {
                await message.reply({ content: 'Simulating monthly leaderboard reset and announcement...', ephemeral: true });

                const raidChannel = await client.channels.fetch(RAID_CHANNEL_ID);
                if (raidChannel && raidChannel.isTextBased()) {
                    const oldLeaderboard = await getCachedLeaderboard(); 
                    const topPlayersBeforeReset = getSortedLeaderboard(oldLeaderboard, 10);
                    const guild = message.guild; // Use the guild where the command was invoked

                    if (guild) {
                        const embed = await createLeaderboardEmbed(client, guild, topPlayersBeforeReset, "Final Leaderboard for Last Month (Simulated Reset)"); 
                        await raidChannel.send({ embeds: [embed] });
                        await raidChannel.send('📈 The monthly leaderboard has been automatically reset (simulated)! Good luck this month, raiders!');
                    } else {
                        console.warn('No guild context to create leaderboard embed for simulated announcement.');
                    }
                } else {
                    console.warn(`RAID_CHANNEL_ID (${RAID_CHANNEL_ID}) is not a text channel or could not be fetched for simulated reset.`);
                }

                await resetLeaderboard(false); // Perform a monthly reset
                await message.channel.send({ content: 'Simulated monthly reset complete.', ephemeral: true });
            } catch (error) {
                console.error('Error simulating new month reset:', error);
                await message.reply('Failed to simulate new month reset. Please check console for errors.');
            }
            return;
        }
    });

    // --- Interaction Create Listener (for buttons) ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        // Check if the button is for !lbcheck pagination
        if (interaction.customId.startsWith('lbcheck_')) {
            const [ command, action, requesterId, timestamp ] = interaction.customId.split('_');
            const sessionKey = interaction.message.id; // Use the message ID as the session key

            const sessionData = activeLbCheckSessions.get(sessionKey);

            if (!sessionData) {
                // Session expired or invalid, disable buttons
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('expired_prev').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('expired_next').setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                await interaction.update({ components: [disabledRow] }).catch(e => console.error("Error updating expired lbcheck message:", e));
                return interaction.followUp({ content: 'This leaderboard session has expired. Please run `!lbcheck` again.', ephemeral: true });
            }

            // Ensure only the original requester can interact with their pagination
            if (interaction.user.id !== sessionData.originalRequesterId) {
                return interaction.reply({ content: 'You can only navigate your own leaderboard checks!', ephemeral: true });
            }

            // Ensure the session hasn't genuinely timed out from the set interval
            if (Date.now() - sessionData.timestamp > LBCHECK_SESSION_LIFETIME_MS) {
                // If it somehow passed the map check but is too old, clean up
                clearTimeout(sessionData.timeoutId); // Clear any pending timeout
                activeLbCheckSessions.delete(sessionKey);
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('expired_prev_2').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('expired_next_2').setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                await interaction.update({ components: [disabledRow] }).catch(e => console.error("Error updating expired lbcheck message (timeout check):", e));
                return interaction.followUp({ content: 'This leaderboard session has expired. Please run `!lbcheck` again.', ephemeral: true });
            }

            // Reset the timeout for the session on interaction
            clearTimeout(sessionData.timeoutId);
            sessionData.timeoutId = setTimeout(async () => {
                activeLbCheckSessions.delete(sessionKey);
                try {
                    const expiredMessage = await interaction.channel.messages.fetch(sessionKey).catch(() => null);
                    if (expiredMessage) {
                        const disabledRow = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder().setCustomId('expired_prev_3').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                                new ButtonBuilder().setCustomId('expired_next_3').setLabel('Next ➡️')
                                .setStyle(ButtonStyle.Secondary).setDisabled(true)
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

            // Ensure current page is within bounds
            sessionData.currentPage = Math.max(1, Math.min(sessionData.currentPage, sessionData.totalPages));

            // Update the session data in the map
            activeLbCheckSessions.set(sessionKey, sessionData);

            // Re-render the embed and components
            const { embeds, components } = await createLbCheckResponse(sessionData, client, interaction.guild);
            await interaction.update({ embeds, components });
        }
    });


    // --- Monthly Leaderboard Reset Logic (Scheduled Task) ---
    // This is a simple in-memory check. For production, consider a more robust scheduler (e.g., cron job).
    setInterval(async () => {
        try {
            const leaderboard = await readLeaderboard(); // Read directly to check reset date
            const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
            const now = new Date();

            // Check if it's a new month (or if lastReset is null/invalid for initial run)
            // This also handles cases where bot was offline during a reset window
            if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
                console.log('Performing automatic monthly leaderboard reset...');

                // Announce the reset in the RAID_CHANNEL_ID
                try {
                    const raidChannel = await client.channels.fetch(RAID_CHANNEL_ID);
                    if (raidChannel && raidChannel.isTextBased()) {
                        // Fetch the top players just before reset for the announcement
                        const oldLeaderboard = await getCachedLeaderboard(); // Get the state BEFORE reset
                        const topPlayersBeforeReset = getSortedLeaderboard(oldLeaderboard, 10);
                        // Ensure we have a guild to pass to createLeaderboardEmbed, ideally from a cached guild
                        // For a scheduled task, you might need to fetch a relevant guild or assume one if the bot is in only one guild.
                        // A more robust solution might pass guild IDs to this handler or fetch the guild.
                        // For now, let's try to get a guild from the client's cache.
                        const guild = client.guilds.cache.first(); // Gets the first guild the bot is in
                        if (guild) {
                            const embed = await createLeaderboardEmbed(client, guild, topPlayersBeforeReset, "Final Leaderboard for Last Month"); // Pass guild here
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

                // Perform a monthly reset (not full reset) AFTER sending the embed
                await resetLeaderboard(false);
            }
        } catch (error) {
            console.error('Error in monthly leaderboard reset check:', error);
        }
    }, 24 * 60 * 60 * 1000); // Check once every 24 hours
}
