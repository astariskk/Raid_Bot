// leaderboardHandler.js - Primary handler for Discord commands and interactions
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'; // Import EmbedBuilder
import { MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID, RAID_CHANNEL_ID } from '../config/constants.js';
import { sendLeaderboardBackup } from './backupHandler.js';

// Import core leaderboard functions and embed creators from the new leaderboardCore.js
import {
    getCachedLeaderboard,
    getSortedLeaderboard,
    resetLeaderboard,
    updateLeaderboard,
    createPaginatedLeaderboardEmbed,
    createLbCheckResponse,
    setupMonthlyResetTask,
    getDailyPointsForRange,
    sendPreviousLeaderboardAnnouncement
} from './leaderboardCore.js';

// --- Pending Reset Confirmations (Shared State) ---
export const pendingResets = new Map();
export const RESET_CONFIRMATION_TIMEOUT_MS = 30 * 1000; // 30 seconds for confirmation timeout.

// --- Active Pagination Sessions (Shared State for !lbcheck and !leaderboard) ---
export const activePaginationSessions = new Map();
export const PAGINATION_SESSION_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes for pagination sessions.


function isAdmin(message) {
    if (!message.member) {
        console.warn('isAdmin called for a message without a member object (e.g., DM).');
        return false;
    }
    return (
        message.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        message.member.roles.cache.has(OFFICER_ROLE_ID) ||
        message.member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}


function getDateRangeFromArgs(content, message) {
    const now = new Date(); // Current date/time in local timezone

    // Helper to get a Date object representing the start of a given day in UTC
    const getUtcMidnight = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        return d;
    };

    let startDate = null;
    let endDate = null;
    let description = '';

    let cleanContent = content.toLowerCase().replace('!lbcheck', '').trim();
    message.mentions.users.forEach(user => {
        cleanContent = cleanContent.replace(new RegExp(`<@!?${user.id}>`, 'g'), '').trim();
    });

    const parts = cleanContent.split(/\s+/).filter(p => p !== '');

    if (parts.length === 0 || parts[0] === 'today') {
        // For 'today', get the current date's UTC midnight
        startDate = getUtcMidnight(now);
        endDate = getUtcMidnight(now);
        description = 'Today';
    } else if (parts[0] === 'yesterday') {
        const yesterday = new Date(now); // Start with current date
        yesterday.setDate(now.getDate() - 1); // Go back one calendar day
        startDate = getUtcMidnight(yesterday);
        endDate = getUtcMidnight(yesterday);
        description = 'Yesterday';
    } else if (parts[0] === 'from' && parts[1] && parts[2] === 'to' && parts[3]) {
        const startDay = parseInt(parts[1], 10);
        const endDay = parseInt(parts[3], 10);

        // Validate day numbers.
        if (isNaN(startDay) || isNaN(endDay) || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay > endDay) {
            return { error: 'Invalid date range. Use `from <day> to <day>` (e.g., `from 10 to 15`). Days must be between 1 and 31.' };
        }
        // Create Date objects for the specific days of the current month, then convert to UTC midnight
        const startOfMonthDay = new Date(now.getFullYear(), now.getMonth(), startDay);
        const endOfMonthDay = new Date(now.getFullYear(), now.getMonth(), endDay);
        startDate = getUtcMidnight(startOfMonthDay);
        endDate = getUtcMidnight(endOfMonthDay);
        description = `From Day ${startDay} to Day ${endDay} of this month`;
    } else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
        const day = parseInt(parts[0], 10);
        if (isNaN(day) || day < 1 || day > 31) {
            return { error: 'Invalid day number. Use a number between 1 and 31.' };
        }
        const specificDay = new Date(now.getFullYear(), now.getMonth(), day);
        startDate = getUtcMidnight(specificDay);
        endDate = getUtcMidnight(specificDay);
        description = `On Day ${day} of this month`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        // For YYYY-MM-DD input, parse it directly and then convert to UTC midnight
        const dateParts = parts[0].split('-');
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(dateParts[2], 10);

        const parsedDate = new Date(year, month, day);
        // Validate if the parsed date components match to ensure it's a valid date
        if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month || parsedDate.getDate() !== day) {
            return { error: 'Invalid date format. Use `YYYY-MM-DD`.' };
        }
        startDate = getUtcMidnight(parsedDate);
        endDate = getUtcMidnight(parsedDate);
        description = `On ${parts[0]}`;
    } else {
        return { error: 'Invalid usage. Use `!lbcheck [today|yesterday|<day>|from <start> to <end>|YYYY-MM-DD] [@user(s)]`' };
    }

    // The getDailyPointsForRange function in dbOps.js uses .toISOString().split('T')[0]
    const formatToISO = (d) => d.toISOString().split('T')[0];

    return {
        startDateISO: formatToISO(startDate),
        endDateISO: formatToISO(endDate),
        description: description,
        rawStartDate: startDate, // These are now UTC Date objects at midnight
        rawEndDate: endDate
    };
}

const createXpEmbed = (action, amount, userIds) => {
    const isPositive = action === 'add';
    const xpString = isPositive ? `added ${amount} EXP to` : `removed ${amount} EXP from`;
    const title = isPositive ? 'EXP Added' : 'EXP Removed';
    const color = isPositive ? 0x00FF00 : 0xFF0000; // Green for add, Red for remove

    const userMentions = userIds.map(id => `<@${id}>`).join(', ');

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`${xpString} to: \n${userMentions}`);
};

export function setupLeaderboardHandlers(client) {
    // --- Message Create Listener (for commands) ---
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const checkAdmin = () => isAdmin(message);

        // --- Handle Leaderboard Command (`!leaderboard` / `!lb`) ---
        if ((message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!lb')) {
            if (!message.guild) {
                return message.reply({ content: "This command can only be used in a server.", ephemeral: true });
            }
            try {
                const leaderboard = await getCachedLeaderboard();
                const allPlayers = getSortedLeaderboard(leaderboard, Infinity, true); // Get all non-zero players
                const lastResetDate = leaderboard._lastResetDate ?
                    new Date(leaderboard._lastResetDate).toLocaleDateString() : 'Never';
                const resetInfo = `Last reset: ${lastResetDate}`;

                const USERS_PER_PAGE = 10;
                const totalPages = Math.ceil(allPlayers.length / USERS_PER_PAGE);
                const initialPage = 1;

                const sessionTimestamp = Date.now();

                const sessionData = {
                    type: 'leaderboard', // Indicate this is a leaderboard session
                    currentPage: initialPage,
                    totalPages: totalPages,
                    usersData: allPlayers,
                    resetInfo: resetInfo,
                    originalRequesterId: message.author.id,
                    timestamp: sessionTimestamp
                };

                const { embeds, components } = await createPaginatedLeaderboardEmbed(sessionData, client, message.guild);
                const sentMessage = await message.channel.send({ embeds, components });

                activePaginationSessions.set(sentMessage.id, sessionData);

                const timeoutId = setTimeout(async () => {
                    activePaginationSessions.delete(sentMessage.id);
                    try {
                        const expiredMessage = await sentMessage.channel.messages.fetch(sentMessage.id).catch(() => null);
                        if (expiredMessage) {
                            const disabledRow = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`lb_prev_disabled_${sessionTimestamp}`)
                                        .setLabel('⬅️ Previous')
                                        .setStyle(ButtonStyle.Primary)
                                        .setDisabled(true),
                                    new ButtonBuilder()
                                        .setCustomId(`lb_next_disabled_${sessionTimestamp}`)
                                        .setLabel('Next ➡️')
                                        .setStyle(ButtonStyle.Primary)
                                        .setDisabled(true)
                                );
                            await expiredMessage.edit({ components: [disabledRow] });
                            console.log(`!leaderboard session for message ${sentMessage.id} expired and buttons disabled.`);
                        }
                    } catch (err) {
                        console.error(`Error disabling buttons for expired !leaderboard session ${sentMessage.id}:`, err);
                    }
                }, PAGINATION_SESSION_LIFETIME_MS);
                sessionData.timeoutId = timeoutId;

            } catch (error) {
                console.error('Error displaying leaderboard:', error);
                await message.reply({ content: 'Failed to retrieve leaderboard. Please try again later.', ephemeral: true });
            }
        }

        // --- Handle Leaderboard Check Command (`!lbcheck`) ---
        if (message.content.toLowerCase().startsWith('!lbcheck')) {
            if (!message.guild) {
                return message.reply({ content: "This command can only be used in a server.", ephemeral: true });
            }

            let targetUsers = [];
            if (message.mentions.users.size > 0) {
                message.mentions.users.forEach(user => targetUsers.push(user));
            }

            const dateInfo = getDateRangeFromArgs(message.content, message);

            if (dateInfo.error) {
                return message.reply({ content: dateInfo.error, ephemeral: true });
            }

            try {
                const leaderboard = await getCachedLeaderboard();

                // Determine the effective set of user IDs to check.
                let effectiveTargetUserIds = new Set();
                if (targetUsers.length > 0) {
                    targetUsers.forEach(user => effectiveTargetUserIds.add(user.id));
                } else {
                    // If no specific users mentioned, get all users who had points in the range
                    // This is where getDailyPointsForRange is called
                    const allDailyPoints = await getDailyPointsForRange(Object.keys(leaderboard).filter(k => !k.startsWith('_')), dateInfo.rawStartDate, dateInfo.rawEndDate);
                    console.log('[leaderboardHandler] Raw daily points from DB for !lbcheck:', allDailyPoints); // Added log
                    allDailyPoints.forEach(entry => effectiveTargetUserIds.add(entry.userId));
                }

                if (effectiveTargetUserIds.size === 0) {
                    return message.reply({ content: `No EXP recorded for anyone ${dateInfo.description}.`, ephemeral: true });
                }

                // Prepare an array of promises to fetch user display names and calculate points for each.
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

                    // Fetch daily data specifically for this user and date range
                    const dailyDataForUser = await getDailyPointsForRange([userId], dateInfo.rawStartDate, dateInfo.rawEndDate);
                    dailyDataForUser.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // Sort by date

                    console.log(`[leaderboardHandler] Daily data for user ${userId}:`, dailyDataForUser); // Added log

                    dailyDataForUser.forEach(entry => {
                        userTotalPointsForRange += entry.points;
                        dailyBreakdown.push(`\`${entry.date}\`: ${entry.points} EXP`);
                    });

                    return {
                        id: userId,
                        displayName: userDisplayName,
                        totalPointsForRange: userTotalPointsForRange,
                        dailyBreakdown: dailyBreakdown,
                        overallTotal: leaderboard[userId] || 0
                    };
                });

                const usersData = await Promise.all(userPromises);

                // Filter out users with 0 points if no specific users were mentioned and it's a general lookup.
                const finalUsersData = (targetUsers.length === 0)
                    ? usersData.filter(u => u.totalPointsForRange > 0)
                    : usersData;

                if (finalUsersData.length === 0) {
                    return message.reply({ content: `No EXP recorded for the specified users/date ${dateInfo.description}.`, ephemeral: true });
                }

                // Sort users by points gained in the specified range for better readability.
                finalUsersData.sort((a, b) => b.totalPointsForRange - a.totalPointsForRange);

                const USERS_PER_PAGE = 5;
                const totalPages = Math.ceil(finalUsersData.length / USERS_PER_PAGE);
                const initialPage = 1;

                const sessionTimestamp = Date.now();

                const sessionData = {
                    type: 'lbcheck', // Indicate this is an lbcheck session
                    currentPage: initialPage,
                    totalPages: totalPages,
                    usersData: finalUsersData,
                    dateInfo: dateInfo,
                    originalRequesterId: message.author.id,
                    timestamp: sessionTimestamp
                };

                // Create the initial embed and components for the first page.
                const { embeds, components } = await createLbCheckResponse(sessionData, client, message.guild);
                const sentMessage = await message.channel.send({ embeds, components });

                // Store session data using the sent message's ID for pagination.
                activePaginationSessions.set(sentMessage.id, sessionData); // Use unified map

                // Set a timeout to clear the session and disable buttons after a period of inactivity.
                const timeoutId = setTimeout(async () => {
                    activePaginationSessions.delete(sentMessage.id);
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
                }, PAGINATION_SESSION_LIFETIME_MS);
                sessionData.timeoutId = timeoutId;

            } catch (error) {
                console.error('Error checking EXP:', error);
                await message.reply({ content: 'Failed to check EXP. Please try again later.', ephemeral: true });
            }
            return;
        }

        // --- Handle Add XP Command (`!addxp`) ---
        if (message.content.toLowerCase().startsWith('!addxp')) {
            if (!checkAdmin()) {
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            const mentions = message.mentions.users;
            const amountMatch = message.content.match(/(-?\d+)$/);

            // Validate command usage.
            if (mentions.size === 0 || !amountMatch) {
                return message.reply({ content: 'Usage: `!addxp @user1 [@user2 ...] <amount>`', ephemeral: true });
            }

            const amount = parseInt(amountMatch[1], 10);
            const addedToUserIds = Array.from(mentions.keys()); // Get an array of IDs

            try {
                // Update leaderboard for each mentioned user.
                for (const id of addedToUserIds) {
                    await updateLeaderboard(id, amount); // This now uses the DB update
                }
                
                // Use the new helper function to create an embed
                const xpEmbed = createXpEmbed('add', amount, addedToUserIds);
                await message.channel.send({ embeds: [xpEmbed] });
                
                // Trigger a backup after modifying the leaderboard.
                await sendLeaderboardBackup(client);
            } catch (error) {
                console.error('Error adding XP:', error);
                await message.reply({ content: 'Failed to add XP. Please try again later.', ephemeral: true });
            }
        }

        // --- Handle Remove XP Command (`!removexp`) ---
        if (message.content.toLowerCase().startsWith('!removexp')) {
            if (!checkAdmin()) {
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            const mentions = message.mentions.users;
            const amountMatch = message.content.match(/(-?\d+)$/);

            // Validate command usage.
            if (mentions.size === 0 || !amountMatch) {
                return message.reply({ content: 'Usage: `!removexp @user1 [@user2 ...] <amount>`', ephemeral: true });
            }

            const amount = parseInt(amountMatch[1], 10);
            const removedFromUserIds = Array.from(mentions.keys()); // Get an array of IDs

            try {
                for (const id of removedFromUserIds) {
                    await updateLeaderboard(id, -amount); // This now uses the DB update
                }
                
                // Use the new helper function to create an embed
                const xpEmbed = createXpEmbed('remove', amount, removedFromUserIds);
                await message.channel.send({ embeds: [xpEmbed] });
                
                await sendLeaderboardBackup(client);
            } catch (error) {
                console.error('Error removing XP:', error);
                await message.reply({ content: 'Failed to remove XP. Please try again later.', ephemeral: true });
            }
        }

        // --- Handle Reset Leaderboard Command (`!resetlb`) ---
        if (message.content.toLowerCase().startsWith('!resetlb')) {
            if (!checkAdmin()) {
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            const args = message.content.toLowerCase().split(/\s+/);
            const fullReset = args.includes('all');

            // Store the pending reset request, awaiting confirmation.
            pendingResets.set(message.author.id, {
                timestamp: Date.now(),
                fullReset: fullReset,
                channelId: message.channel.id
            });

            await message.reply({
                content: `Are you sure you want to ${fullReset ? '**fully** ' : ''}reset the leaderboard? This action is irreversible. Type \`!confirm\` in this channel within ${RESET_CONFIRMATION_TIMEOUT_MS / 1000} seconds to proceed, or \`!cancel\` to abort.`,
                ephemeral: true
            });

            // Set a timeout to clear the pending request if not confirmed within the duration.
            const timeoutId = setTimeout(async () => {
                const currentPending = pendingResets.get(message.author.id);
                if (currentPending && currentPending.channelId === message.channel.id && Date.now() - currentPending.timestamp < RESET_CONFIRMATION_TIMEOUT_MS) {
                    pendingResets.delete(message.author.id);
                    message.author.send(`Your leaderboard reset confirmation in <#${message.channel.id}> has expired. Please try \`!resetlb\` again if you wish to proceed.`).catch(err => console.error(`Failed to send expiration message to user ${message.author.id}:`, err));
                }
            }, RESET_CONFIRMATION_TIMEOUT_MS);
            pendingResets.get(message.author.id).timeoutId = timeoutId;

            return;
        }

        // --- Handle Confirmation Command (`!confirm`) ---
        if (message.content.toLowerCase() === '!confirm') {
            const pending = pendingResets.get(message.author.id);

            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                if (!checkAdmin()) {
                    return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                }
                return message.reply({ content: 'No pending leaderboard reset confirmation found or it has expired. Please use `!resetlb` first.', ephemeral: true });
            }

            if (!checkAdmin()) {
                pendingResets.delete(message.author.id);
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            if (pending.timeoutId) {
                clearTimeout(pending.timeoutId);
            }
            pendingResets.delete(message.author.id);

            try {
                await resetLeaderboard(pending.fullReset); // Perform the reset.
                await message.reply({ content: `Leaderboard ${pending.fullReset ? 'fully' : 'monthly'} reset successfully!`, ephemeral: true });
                await sendLeaderboardBackup(client);
            } catch (error) {
                console.error('Error resetting leaderboard:', error);
                await message.reply({ content: 'Failed to reset leaderboard. Please try again later.', ephemeral: true });
            }
            return;
        }

        // --- Handle Cancellation Command (`!cancel`) ---
        if (message.content.toLowerCase() === '!cancel') {
            const pending = pendingResets.get(message.author.id);

            if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
                if (!checkAdmin()) {
                    return
                }
                return message.reply({ content: 'No pending leaderboard reset to cancel.', ephemeral: true });
            }

            if (!checkAdmin()) {
                pendingResets.delete(message.author.id);
                return message.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            if (pending.timeoutId) {
                clearTimeout(pending.timeoutId);
            }
            pendingResets.delete(message.author.id);
            await message.reply({ content: 'Leaderboard reset cancelled.', ephemeral: true });
            return;
        }

        if (message.content.toLowerCase() ==='!sendprevlb') {
        await sendPreviousLeaderboardAnnouncement(client, true); // true indicates it's a manual trigger
        await interaction.reply({ content: 'Sent previous month\'s leaderboard announcement to the management channel!', ephemeral: true });
}
    });

    // --- Interaction Create Listener (for pagination buttons) ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        // Check if the button customId starts with 'lb_' or 'lbcheck_'.
        if (interaction.customId.startsWith('lb_') || interaction.customId.startsWith('lbcheck_')) {
            const [prefix, action, originalRequesterId, timestampStr] = interaction.customId.split('_');
            const sessionTimestamp = parseInt(timestampStr, 10);
            const sessionKey = interaction.message.id; // Use the message ID as the session key.

            const sessionData = activePaginationSessions.get(sessionKey);

            // If session not found or timed out, inform the user and disable buttons.
            if (!sessionData || Date.now() - sessionData.timestamp > PAGINATION_SESSION_LIFETIME_MS) {
                // If it somehow passed the map check but is too old, clean up
                if (sessionData && sessionData.timeoutId) {
                    clearTimeout(sessionData.timeoutId); // Clear any pending timeout
                }
                activePaginationSessions.delete(sessionKey);

                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('expired_prev').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('expired_next').setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                await interaction.update({ components: [disabledRow] }).catch(e => console.error("Error updating expired pagination message:", e));
                return interaction.followUp({ content: 'This session has expired. Please run the command again.', ephemeral: true });
            }

            // Ensure only the original requester can interact with their pagination.
            if (interaction.user.id !== sessionData.originalRequesterId) {
                return interaction.reply({ content: 'You can only navigate your own command results!', ephemeral: true });
            }

            // Defer the update to prevent interaction failed error.
            await interaction.deferUpdate();

            // Clear the existing timeout and set a new one to extend session lifetime.
            clearTimeout(sessionData.timeoutId);
            sessionData.timeoutId = setTimeout(async () => {
                activePaginationSessions.delete(sessionKey);
                try {
                    const expiredMessage = await interaction.channel.messages.fetch(sessionKey).catch(() => null);
                    if (expiredMessage) {
                        const disabledRow = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder().setCustomId(`${prefix}_prev_disabled_${sessionTimestamp}`)
                                    .setLabel('⬅️ Previous')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(true),
                                new ButtonBuilder()
                                    .setCustomId(`${prefix}_next_disabled_${sessionTimestamp}`)
                                    .setLabel('Next ➡️')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(true)
                            );
                        await expiredMessage.edit({ components: [disabledRow] });
                        console.log(`${prefix} session for message ${sessionKey} expired and buttons disabled.`);
                    }
                } catch (err) {
                    console.error(`Error disabling buttons for expired ${prefix} session ${sessionKey}:`, err);
                }
            }, PAGINATION_SESSION_LIFETIME_MS);


            if (action === 'next') {
                sessionData.currentPage++;
            } else if (action === 'prev') {
                sessionData.currentPage--;
            }

            // Ensure current page is within bounds.
            sessionData.currentPage = Math.max(1, Math.min(sessionData.currentPage, sessionData.totalPages));

            // Update the session data in the map.
            activePaginationSessions.set(sessionKey, sessionData);

            // Re-render the embed and components based on session type.
            let response;
            if (sessionData.type === 'leaderboard') {
                response = await createPaginatedLeaderboardEmbed(sessionData, client, interaction.guild);
            } else if (sessionData.type === 'lbcheck') {
                response = await createLbCheckResponse(sessionData, client, interaction.guild);
            }

            await interaction.editReply(response);
        }
    });

    // Setup the monthly reset task when the main handler is set up
    setupMonthlyResetTask(client);
}