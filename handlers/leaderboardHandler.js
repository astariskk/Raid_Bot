// handlers/leaderboardHandler.js
import { EmbedBuilder } from 'discord.js';
import { readLeaderboard, writeLeaderboard } from '../utils/fileOps.js';
import { LEADERBOARD_FILE } from '../config/constants.js'; // Import LEADERBOARD_FILE

export function setupLeaderboardHandlers(client) {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

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
        // !IMPORTANT: You should restrict this command to specific roles or users for security.
        if (message.content.toLowerCase() === '!reset') {
            // Optional: Add a check for user permissions here
            // if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            //     return message.reply("You don't have permission to use this command.");
            // }

            try {
                const leaderboard = await readLeaderboard();
                const lastResetDate = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;

                // Prevent multiple resets in a short period (e.g., within the same day)
                const now = new Date();
                /* if (lastResetDate && now.getFullYear() === lastResetDate.getFullYear() &&
                    now.getMonth() === lastResetDate.getMonth() && now.getDate() === lastResetDate.getDate()) {
                    return message.reply('Leaderboard has already been reset today. Please wait until tomorrow for another reset.');
                }
                */

                // Confirm reset
                await message.reply({ content:'Are you sure you want to reset the leaderboard? Reply with `confirm` within 15 seconds.', ephemeral: true});

                const filter = response =>
                    response.author.id === message.author.id &&
                    response.content.toLowerCase() === 'confirm';

                try {
                    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
                    if (collected.first()) {
                        const newLeaderboard = {
                            _lastResetDate: now.toISOString() // Store the reset date
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
    });
}

async function getLeaderboardEmbed(client) {
    const leaderboard = await readLeaderboard();
    // Exclude internal properties like _lastResetDate from sorting
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