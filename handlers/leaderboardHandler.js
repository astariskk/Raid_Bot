// handlers/leaderboardHandler.js
import { EmbedBuilder, PermissionsBitField } from 'discord.js'; // Import PermissionsBitField
import { readLeaderboard, writeLeaderboard, updateLeaderboard } from '../utils/fileOps.js';
import { LEADERBOARD_FILE } from '../config/constants.js'; // Import LEADERBOARD_FILE

export function setupLeaderboardHandlers(client) {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        // Helper function to check for admin permissions
        const isAdmin = () => message.member.permissions.has(PermissionsBitField.Flags.Administrator);

        // Handle Leaderboard Command
        if (message.content.toLowerCase() === '!leaderboard') {
            try {
                const leaderboardEmbed = await getLeaderboardEmbed(client);
                await message.channel.send({ embeds: [leaderboardEmbed] });
            } catch (error) {
                console.error('Error sending leaderboard:', error);
                await message.channel.send('Failed to fetch leaderboard. Please try again later.');
            }
        }

        // Handle Reset Leaderboard Command
        if (message.content.toLowerCase().startsWith('!reset')) {
            if (!isAdmin()) {
                return message.reply("You don't have permission to use this command.");
            }

            const args = message.content.toLowerCase().split(/\s+/);
            const resetAll = args[1] === 'all'; // Check if 'all' argument is present

            try {
                const leaderboard = await readLeaderboard();
                const lastResetDate = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
                const now = new Date();

                // Check for monthly reset
                let performReset = false;
                if (lastResetDate) {
                    // Check if current month/year is different from last reset month/year
                    if (now.getFullYear() > lastResetDate.getFullYear() || 
                        (now.getFullYear() === lastResetDate.getFullYear() && now.getMonth() > lastResetDate.getMonth())) {
                        performReset = true;
                    }
                } else {
                    // No last reset date, assume first reset
                    performReset = true;
                }

                if (!performReset && !resetAll) { // If not a monthly reset and not explicitly requesting 'all' reset
                    return message.reply('Leaderboard can only be reset once per month. If you want to force a full reset, use `!reset all`.');
                }
                
                // Confirm reset
                await message.reply({ content: 'Are you sure you want to reset the leaderboard? Reply with `confirm` within 15 seconds.', ephemeral: true });

                const filter = response =>
                    response.author.id === message.author.id &&
                    response.content.toLowerCase() === 'confirm';

                try {
                    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
                    if (collected.first()) {
                        const newLeaderboard = {
                            _lastResetDate: now.toISOString(), // Store the reset date
                            _dailyPoints: {} // Clear daily points on monthly reset
                        };
                        await writeLeaderboard(newLeaderboard);
                        await message.channel.send('Leaderboard has been successfully reset!');
                        console.log('Leaderboard reset by:', message.author.tag);
                    }
                } catch (error) {
                    await message.channel.send('Leaderboard reset cancelled. You did not confirm in time.');
                }

            } catch (error) {
                console.error('Error resetting leaderboard:', error);
                await message.channel.send('Failed to reset leaderboard. Please try again later.');
            }
        }

        // Handle Add XP Command
        if (message.content.toLowerCase().startsWith('!addxp')) {
            if (!isAdmin()) {
                return message.reply("You don't have permission to use this command.");
            }

            const args = message.content.split(/\s+/);
            if (args.length < 3 || !message.mentions.users.first() || isNaN(parseInt(args[2]))) {
                return message.reply('Usage: `!addxp @user <amount>`');
            }

            const userId = message.mentions.users.first().id;
            const amount = parseInt(args[2]);

            try {
                await updateLeaderboard(userId, amount); // updateLeaderboard will add the points
                await message.reply(`Successfully added ${amount} EXP to <@${userId}>.`);
            } catch (error) {
                console.error('Error adding XP:', error);
                await message.reply('Failed to add XP. Please try again later.');
            }
        }

        // Handle Remove XP Command
        if (message.content.toLowerCase().startsWith('!removexp')) {
            if (!isAdmin()) {
                return message.reply("You don't have permission to use this command.");
            }

            const args = message.content.split(/\s+/);
            if (args.length < 3 || !message.mentions.users.first() || isNaN(parseInt(args[2]))) {
                return message.reply('Usage: `!removexp @user <amount>`');
            }

            const userId = message.mentions.users.first().id;
            const amount = parseInt(args[2]);

            try {
                await updateLeaderboard(userId, -amount); // updateLeaderboard will subtract the points
                await message.reply(`Successfully removed ${amount} EXP from <@${userId}>.`);
            } catch (error) {
                console.error('Error removing XP:', error);
                await message.reply('Failed to remove XP. Please try again later.');
            }
        }

        // Handle Check Rewards Command
        if (message.content.toLowerCase().startsWith('!lbcheck')) {
            const args = message.content.toLowerCase().split(/\s+/);
            let targetDate = new Date(); // Default to today
            let targetUserId = null;

            // Parse arguments
            if (args.length > 1) {
                if (message.mentions.users.first()) {
                    targetUserId = message.mentions.users.first().id;
                    if (args[1] !== 'today' && args[1] !== 'yesterday' && !/^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
                         // If user mentioned, date is optional, and can be 'today' or 'yesterday' or YYYY-MM-DD
                        if (args[1] === 'today') {
                            targetDate = new Date();
                        } else if (args[1] === 'yesterday') {
                            targetDate.setDate(targetDate.getDate() - 1);
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
                             targetDate = new Date(args[1]);
                        } else {
                            // Assume the date argument is missing and the mention is the first arg
                            targetDate = new Date(); // default to today
                        }
                    }
                } else if (args[1] === 'today') {
                    targetDate = new Date();
                } else if (args[1] === 'yesterday') {
                    targetDate.setDate(targetDate.getDate() - 1);
                } else if (/^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
                    targetDate = new Date(args[1]);
                } else {
                    return message.reply('Usage: `!checkrewards [today|yesterday|YYYY-MM-DD] [@user]`');
                }
            }

            // If a user mention is the *second* argument, and no date was given as first arg
            if (args.length === 2 && message.mentions.users.first() && !/^(today|yesterday|\d{4}-\d{2}-\d{2})$/.test(args[1])) {
                targetUserId = message.mentions.users.first().id;
                targetDate = new Date(); // Default to today if only user is specified
            }

            try {
                const leaderboard = await readLeaderboard();
                const dailyPointsData = leaderboard._dailyPoints || {};

                const dateKey = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
                const pointsForDay = dailyPointsData[dateKey];

                let embedDescription = '';
                if (!pointsForDay || Object.keys(pointsForDay).length === 0) {
                    embedDescription = `No points recorded for ${targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`;
                } else {
                    let filteredPoints = {};
                    if (targetUserId) {
                        if (pointsForDay[targetUserId]) {
                            filteredPoints[targetUserId] = pointsForDay[targetUserId];
                        }
                    } else {
                        filteredPoints = pointsForDay;
                    }

                    if (Object.keys(filteredPoints).length === 0) {
                         embedDescription = `No points recorded for <@${targetUserId}> on ${targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`;
                    } else {
                        const sortedDailyEntries = Object.entries(filteredPoints).sort(([, a], [, b]) => b - a);
                        
                        embedDescription = await Promise.all(sortedDailyEntries.map(async ([userId, points]) => {
                            try {
                                const user = await client.users.fetch(userId);
                                return `<@${user.id}>: ${points} EXP`;
                            } catch (error) {
                                console.error(`Could not fetch user ${userId} for daily rewards:`, error);
                                return `<@${userId}>: ${points} EXP (User Unknown)`;
                            }
                        }));
                        embedDescription = `**Points for ${targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}:**\n` + embedDescription.join('\n');
                    }
                }

                const rewardsEmbed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`Daily Rewards Report`)
                    .setDescription(embedDescription)
                    .setTimestamp();

                await message.channel.send({ embeds: [rewardsEmbed] });

            } catch (error) {
                console.error('Error checking daily rewards:', error);
                await message.channel.send('Failed to retrieve daily rewards. Please try again later.');
            }
        }
    });
}

async function getLeaderboardEmbed(client) {
    const leaderboard = await readLeaderboard();
    // Exclude internal properties like _lastResetDate and _dailyPoints from sorting
    const filteredLeaderboard = Object.fromEntries(
        Object.entries(leaderboard).filter(([key]) => !key.startsWith('_'))
    );

    const sortedEntries = Object.entries(filteredLeaderboard).sort(([, a], [, b]) => b - a);

    if (sortedEntries.length === 0) {
        return new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('Leaderboard')
            .setDescription('No points recorded yet!');
    }

    const leaderboardText = await Promise.all(sortedEntries.slice(0, 10).map(async ([userId, points], index) => {
        try {
            const user = await client.users.fetch(userId);
            return `${index + 1}. **${user.username}**: ${points} EXP`;
        } catch (error) {
            console.error(`Could not fetch user ${userId} for leaderboard:`, error);
            return `${index + 1}. **Unknown User (${userId})**: ${points} EXP`;
        }
    }));

    const lastResetDate = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : 'Never';

    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🏆 Raid Helper Leaderboard 🏆')
        .setDescription(leaderboardText.join('\n'))
        .setTimestamp()
        .setFooter({ text: `Earn points by helping out with raids! Last reset: ${lastResetDate}` });
}
