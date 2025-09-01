// leaderboardCore.js - Core logic for leaderboard data, embeds, and monthly task

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { RAID_MANAGEMENT_CHANNEL_ID } from '../config/constants.js';
import { sendLeaderboardBackup } from './backupHandler.js';

// Import database operations instead of file operations
import { connectDB, getLeaderboardData as fetchLeaderboardFromDB, setLeaderboardData as writeLeaderboardToDB, updateUserExp as updateExpInDB, getDailyPointsForRange } from '../utils/dbOps.js';

// --- Leaderboard Cache ---
const CACHE_LIFETIME_MS = 5 * 60 * 1000;
let leaderboardCache = null;
let lastCacheTime = 0;

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

export async function resetLeaderboard(fullReset = false) {
    const newLeaderboardState = {
        _lastResetDate: new Date().toISOString(),
        _dailyPoints: {} 
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

    await writeLeaderboardToDB(newLeaderboardState); 
    leaderboardCache = null; 

    if (fullReset) {
        console.log('Full leaderboard reset initiated (all user entries removed).');
    } else {
        console.log('Monthly leaderboard reset initiated (existing user EXP set to 0).');
    }
}

export async function updateLeaderboard(userId, pointsToAdd) {
    await updateExpInDB(userId, pointsToAdd);
    leaderboardCache = null; // Invalidate cache so next read fetches fresh data
}

export async function createPaginatedLeaderboardEmbed(sessionData, client, guild) {
    const { currentPage, totalPages, usersData, resetInfo, originalRequesterId, timestamp } = sessionData;
    const USERS_PER_PAGE = 10; // Number of users to display per page for the main leaderboard.

    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, usersData.length);
    const usersOnPage = usersData.slice(startIndex, endIndex); // Get users for the current page.

    const embed = new EmbedBuilder()
        .setColor(0x0099FF) // Blue color.
        .setTitle('🏆 Raid Leaderboard 🏆')
        .setDescription(`${resetInfo}\n\n`) // Move resetInfo here for multi-embed announcement consistency
        .setTimestamp()
        .setFooter({ text: `Page ${currentPage}/${totalPages} | Raid Leaderboard Rankings` });

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

    // Create pagination buttons ONLY if it's not a scheduled reset (i.e., not for the multi-embed thread)
    const row = new ActionRowBuilder();
    if (originalRequesterId !== 'scheduled_reset') {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`lb_start_${originalRequesterId}_${timestamp}`) // Added 'start' button
                .setLabel('⏮️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lb_prev_${originalRequesterId}_${timestamp}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lb_next_${originalRequesterId}_${timestamp}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages),
            new ButtonBuilder()
                .setCustomId(`lb_end_${originalRequesterId}_${timestamp}`) // Added 'end' button
                .setLabel('⏭️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages)
        );
    }


    // Return components only if there are any (i.e., not for scheduled reset)
    return { embeds: [embed], components: row.components.length > 0 ? [row] : [] };
}

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
                .setCustomId(`lbcheck_start_${originalRequesterId}_${timestamp}`)
                .setLabel('⏮️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lbcheck_prev_${originalRequesterId}_${timestamp}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`lbcheck_next_${originalRequesterId}_${timestamp}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages),
            new ButtonBuilder()
                .setCustomId(`lbcheck_end_${originalRequesterId}_${timestamp}`)
                .setLabel('⏭️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages)
        );

    return { embeds: [embed], components: [row] };
}

export async function sendPreviousLeaderboardAnnouncement(client, isManualTrigger = false) {
    try {
        const now = new Date();
        const managementChannel = await client.channels.fetch(RAID_MANAGEMENT_CHANNEL_ID);
        if (!managementChannel || !managementChannel.isTextBased()) {
            console.warn(`RAID_MANAGEMENT_CHANNEL_ID (${RAID_MANAGEMENT_CHANNEL_ID}) is not a text channel or could not be fetched.`);
            return;
        }

        const guild = client.guilds.cache.first(); // Assuming one main guild.
        if (!guild) {
            console.warn('No guild found to create leaderboard embed for announcement.');
            return;
        }

        const oldLeaderboard = await getCachedLeaderboard();
        const allSortedPlayers = getSortedLeaderboard(oldLeaderboard, Infinity, true);

        const USERS_PER_PAGE = 10;
        const totalPages = Math.ceil(allSortedPlayers.length / USERS_PER_PAGE);

        const targetMonth = new Date(now.getFullYear(), now.getMonth() - (isManualTrigger ? 0 : 1), 1); // Adjust for manual trigger to show current month, otherwise previous
        const displayMonthYear = targetMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const resetInfoDescription = `Final Leaderboard for ${displayMonthYear}`;

        if (allSortedPlayers.length === 0) {
            await managementChannel.send(`Monthly Raid Leaderboard for ${displayMonthYear}: No raids were recorded last month.`);
            return;
        }

        const initialMessage = await managementChannel.send(`## Monthly Raid Leaderboard for ${displayMonthYear}`);

        const threadChannel = await initialMessage.startThread({
            name: `Raid Leaderboard - ${displayMonthYear}`,
            autoArchiveDuration: 1440,
            reason: `Monthly leaderboard announcement for ${displayMonthYear}`,
        });
        console.log(`Created new thread for monthly leaderboard: ${threadChannel.name}`);

        for (let i = 1; i <= totalPages; i++) {
            const sessionData = {
                currentPage: i,
                totalPages: totalPages,
                usersData: allSortedPlayers,
                resetInfo: resetInfoDescription,
                originalRequesterId: 'scheduled_reset', // Still use this to prevent buttons
                timestamp: Date.now()
            };
            const { embeds } = await createPaginatedLeaderboardEmbed(sessionData, client, guild);
            await threadChannel.send({ embeds: embeds });
        }
    } catch (error) {
        console.error('Error sending previous leaderboard announcement:', error);
    }
}


// Sets up the scheduled task for monthly leaderboard reset.
export function setupMonthlyResetTask(client) {
    const performMonthlyCheck = async () => {
        try {
            const leaderboard = await getCachedLeaderboard(); // Use cached version for consistency
            const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
            const now = new Date();

            // Check if it's a new month or if there's no last reset date recorded.
            if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
                console.log('Performing automatic monthly leaderboard reset...');

                // Send the announcement for the *previous* month
                await sendPreviousLeaderboardAnnouncement(client, false); // false indicates not a manual trigger

                // After sending all pages, perform the reset and backup
                await resetLeaderboard(false);
                await sendLeaderboardBackup(client);

            }
        } catch (error) {
            console.error('Error in monthly leaderboard reset check:', error);
        }
    };

    // Run the check once immediately when the bot starts
    performMonthlyCheck();

    // Then, set up the recurring check every 6 hours
    setInterval(performMonthlyCheck, 6 * 60 * 60 * 1000);
}
export {
    getDailyPointsForRange,
};
