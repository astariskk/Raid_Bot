// handlers/leaderboardHandler.js
import { EmbedBuilder } from 'discord.js';
import { readLeaderboard, writeLeaderboard, updateLeaderboard } from '../utils/fileOps.js'; // Ensure updateLeaderboard is imported
import { LEADERBOARD_FILE } from '../config/constants.js'; // Assuming LEADERBOARD_FILE is defined here

const CACHE_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes for leaderboard cache
let leaderboardCache = null;
let lastCacheTime = 0;

/**
 * Checks if the message author has administrator permissions.
 * @param {import('discord.js').Message} message The Discord message object.
 * @returns {boolean} True if the author is an administrator, false otherwise.
 */
function isAdmin(message) {
    // This function assumes the bot has access to guild member permissions.
    // Ensure GatewayIntentBits.GuildMembers is enabled in your client.
    return message.member && message.member.permissions.has('Administrator');
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
 * @param {Array<{userId: string, totalExp: number}>} topPlayers - Sorted array of top players.
 * @param {string} resetInfo - Information about the last reset.
 * @returns {EmbedBuilder} The leaderboard embed.
 */
function createLeaderboardEmbed(topPlayers, resetInfo) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🏆 Raid Leaderboard 🏆')
        .setDescription(`Current Top 10 by Total EXP!\n\n${resetInfo}`)
        .setTimestamp();

    if (topPlayers.length === 0) {
        embed.addFields({ name: 'No Data Yet', value: 'The leaderboard is empty. Start earning some EXP!' });
    } else {
        topPlayers.forEach((player, index) => {
            embed.addFields({
                name: `${index + 1}. ${player.userId === 'bot-id' ? 'Bot User' : `<@${player.userId}>`}`, // Example for bot exclusion/naming
                value: `${player.totalExp} EXP`,
                inline: false
            });
        });
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
            try {
                const leaderboard = await getCachedLeaderboard();
                const topPlayers = getSortedLeaderboard(leaderboard, 10);
                const lastResetDate = leaderboard._lastResetDate ?
                    new Date(leaderboard._lastResetDate).toLocaleDateString() : 'Never';
                const resetInfo = `Last reset: ${lastResetDate}`;
                const embed = createLeaderboardEmbed(topPlayers, resetInfo);
                await message.channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Error displaying leaderboard:', error);
                await message.reply('Failed to retrieve leaderboard. Please try again later.');
            }
        }

        // --- Handle Leaderboard Check Command (!lbcheck) ---
        if (message.content.toLowerCase().startsWith('!lbcheck')) {
            const args = message.content.split(/\s+/);
            let dateString = 'today'; // Default to today
            let targetUser = message.author; // Default to command invoker

            // Parse date (today, yesterday, YYYY-MM-DD)
            if (args.length > 1 && !message.mentions.users.first()) {
                dateString = args[1].toLowerCase();
            }

            // Parse user mention if present (can be after date or directly after !lbcheck)
            if (message.mentions.users.first()) {
                targetUser = message.mentions.users.first();
                // If a user is mentioned as the second argument, and no date was explicitly given
                // as a keyword, then assume it's !lbcheck @user
                if (args.length === 2 && args[1].startsWith('<@')) {
                    dateString = 'today'; // Default to today if only user is mentioned
                } else if (args.length > 2 && args[2].startsWith('<@')) {
                    // if it's !lbcheck <date> @user, the dateString is already set
                } else if (args.length > 1 && args[1].startsWith('<@')) {
                    // if it's !lbcheck @user, dateString remains 'today'
                }
            }


            let dateToFetch;
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize to start of day UTC

            if (dateString === 'today') {
                dateToFetch = today.toISOString().split('T')[0];
            } else if (dateString === 'yesterday') {
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                dateToFetch = yesterday.toISOString().split('T')[0];
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                // Validate custom date format YYYY-MM-DD
                const parts = dateString.split('-');
                const checkDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                if (checkDate.getFullYear() != parts[0] || checkDate.getMonth() != parseInt(parts[1]) - 1 || checkDate.getDate() != parts[2]) {
                    return message.reply('Invalid date format. Use `YYYY-MM-DD`, `today`, or `yesterday`.');
                }
                dateToFetch = dateString;
            } else {
                // If the second arg is not a recognized date keyword or mention, it's invalid usage
                return message.reply('Invalid usage. Usage: `!lbcheck [today|yesterday|YYYY-MM-DD] [@user]`');
            }

            try {
                const leaderboard = await getCachedLeaderboard();
                const dailyPoints = leaderboard._dailyPoints && leaderboard._dailyPoints[dateToFetch] ?
                    leaderboard._dailyPoints[dateToFetch][targetUser.id] || 0 : 0;
                const totalPoints = leaderboard[targetUser.id] || 0;

                const checkEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`📊 EXP Check for ${targetUser.username} 📊`)
                    .setDescription(`For Date: \`${dateToFetch}\``)
                    .addFields(
                        { name: 'EXP Gained Today', value: `${dailyPoints} EXP`, inline: true },
                        { name: 'Total EXP', value: `${totalPoints} EXP`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Raid Helper Bot | Daily EXP' });

                await message.channel.send({ embeds: [checkEmbed] });

            } catch (error) {
                console.error('Error checking daily XP:', error);
                await message.reply('Failed to check XP. Please try again later.');
            }
        }

        // --- Handle Add XP Command ---
        if (message.content.toLowerCase().startsWith('!addxp')) {
            if (!checkAdmin()) {
                return message.reply("You don't have permission to use this command.");
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
                return message.reply("You don't have permission to use this command.");
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

        // --- Handle Reset Command ---
        if (message.content.toLowerCase().startsWith('!reset')) {
            if (!checkAdmin()) {
                return message.reply("You don't have permission to use this command.");
            }

            const args = message.content.toLowerCase().split(/\s+/);
            const fullReset = args.includes('all');

            try {
                await resetLeaderboard(fullReset);
                await message.reply(`Leaderboard ${fullReset ? 'fully' : 'monthly'} reset successfully!`);
            } catch (error) {
                console.error('Error resetting leaderboard:', error);
                await message.reply('Failed to reset leaderboard. Please try again later.');
            }
        }
    });

    // --- Monthly Leaderboard Reset Logic (Scheduled Task) ---
    // This is a simple in-memory check. For production, consider a more robust scheduler (e.g., cron job).
    setInterval(async () => {
        try {
            const leaderboard = await readLeaderboard(); // Read directly to check reset date
            const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
            const now = new Date();

            if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
                // If it's a new month or no reset date, perform a monthly reset
                console.log('Performing automatic monthly leaderboard reset...');
                await resetLeaderboard(false); // Perform a monthly reset (not full reset)

                // Optional: Announce the reset in a specific channel
                const announcementChannelId = 'YOUR_ANNOUNCEMENT_CHANNEL_ID'; // <--- IMPORTANT: Configure this!
                try {
                    const channel = await client.channels.fetch(announcementChannelId);
                    if (channel && channel.isTextBased()) {
                        await channel.send('📈 The monthly leaderboard has been automatically reset! Good luck this month, raiders!');
                    }
                } catch (channelError) {
                    console.error('Error sending leaderboard reset announcement:', channelError);
                }
            }
        } catch (error) {
            console.error('Error in monthly leaderboard reset check:', error);
        }
    }, 24 * 60 * 60 * 1000); // Check once every 24 hours
}
